/**
 * @file Measures real Workspace kernel operations in a disposable G-A reference workspace.
 * No packaged startup, Electron IPC, Renderer, other-platform result, or G7 verdict is implied.
 */

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {setImmediate as yieldToIo} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

/** Repository paths follow this script; no machine-specific workspace path is stored. */
const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Validates the one new output directory and the optional bounded verification profile. */
function parseOptions(args) {
    const shortReference = args.includes('--short-reference');
    const remaining = args.filter(value => value !== '--short-reference');
    assert.ok(args.length === remaining.length + (shortReference ? 1 : 0), 'Repeated flag');
    assert.ok(remaining.length === 2 && remaining[0] === '--output',
        'Usage: node scripts/measure-ga-reference.mjs --output ABSOLUTE_NEW_DIRECTORY [--short-reference]');
    assert.ok(path.isAbsolute(remaining[1]), '--output must be absolute');
    const output = path.resolve(remaining[1]);
    assert.equal(existsSync(output), false, '--output already exists; existing DATA is never overwritten');
    return {output, shortReference};
}

if (process.argv.length === 3 && process.argv[2] === '--help') {
    process.stdout.write('Usage: node scripts/measure-ga-reference.mjs --output ABSOLUTE_NEW_DIRECTORY\n'
        + '       [--short-reference]\n'
        + 'Run pnpm test:compile first. Measures host Workspace kernel only; never packaged startup or all G7.\n'
        + '--short-reference seeds the same data, then measures only 20 commits/queries with real backup.\n');
    process.exit(0);
}

if (process.argv.length === 3 && process.argv[2] === '--self-check') {
    assert.throws(() => parseOptions([]));
    assert.throws(() => parseOptions(['--output', 'relative-directory']));
    assert.throws(() => parseOptions(['--output', REPOSITORY]));
    assert.throws(() => parseOptions(['--output', REPOSITORY, '--unknown']));
    assert.equal(summarize(Array.from({length: 20}, (_, index) => index + 1)).p95Milliseconds, 19);
    assert.equal(summarize(Array.from({length: 20}, (_, index) => index + 1)).p99Milliseconds, null);
    process.stdout.write('PASS CLI refusal and nearest-rank self-check; no DATA created.\n');
    process.exit(0);
}

/** The CLI owns only a previously absent directory selected explicitly by the caller. */
const OPTIONS = parseOptions(process.argv.slice(2));
const SHORT_REFERENCE = OPTIONS.shortReference;
const REFERENCE = OPTIONS.output;
const DATA = path.join(REFERENCE, 'Local', 'CourseFlow Dev', 'DataSlots');
const BACKUP = path.join(REFERENCE, 'b');
const SOURCE = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: REPOSITORY, encoding: 'utf8'}).trim();
const BUILD = `development:${SOURCE}`;
const CLOCK = {now: () => '2026-09-10T13:30:00.000Z'};
const WINDOW = {startDate: '2026-09-01', endDate: '2026-09-30'};
const require = createRequire(import.meta.url);
const {WorkspaceApplication} = require(path.join(REPOSITORY, '.test-dist/src/workspace/application.js'));
const {makeBootstrapRequest} = require(path.join(REPOSITORY, '.test-dist/src/shared/bootstrap-contract.js'));
const api = require(path.join(REPOSITORY, '.test-dist/src/shared/workspace-setup-contract.js'));

/** Computes nearest-rank quantiles while retaining every observation. */
function summarize(samples) {
    assert.ok(samples.length >= 20, 'At least 20 observations are required');
    assert.ok(samples.every(value => Number.isFinite(value) && value >= 0));
    const ordered = Array.from(samples).sort((left, right) => left - right);
    const quantile = percentile => ordered[Math.ceil(percentile * ordered.length) - 1];
    return {
        count: samples.length,
        p50Milliseconds: quantile(0.5),
        p95Milliseconds: quantile(0.95),
        p99Milliseconds: samples.length >= 100 ? quantile(0.99) : null,
        maxMilliseconds: ordered.at(-1),
        samplesMilliseconds: samples,
    };
}

/** Totals only files under the caller-owned reference tree. */
function directoryBytes(directory) {
    if (!existsSync(directory)) {
        return 0;
    }
    return readdirSync(directory, {withFileTypes: true}).reduce((total, entry) => {
        const target = path.join(directory, entry.name);
        assert.equal(entry.isSymbolicLink(), false, 'Reference tree must not contain links');
        return total + (entry.isDirectory() ? directoryBytes(target) : statSync(target).size);
    }, 0);
}

/** Executes the approved isolated experiment once, refusing to overwrite any existing reference. */
async function main() {
    assert.equal(existsSync(REFERENCE), false, 'Reference already exists; review it instead of overwriting DATA');
    mkdirSync(REFERENCE);
    mkdirSync(DATA, {recursive: true});
    mkdirSync(BACKUP);
    const report = {
        status: 'running',
        scope: 'host-node Workspace kernel on the recorded platform; no packaged or other-platform evidence',
        sourceCommit: SOURCE,
        appBuildId: BUILD,
        worktreeStatus: execFileSync('git', ['status', '--short'], {cwd: REPOSITORY, encoding: 'utf8'}).trim(),
        sourceBoundary: 'Checkout HEAD and actual dirty state; neither proves a clean packaged build',
        compilation: 'Run pnpm test:compile immediately before measurement; compiled output has no embedded build ID',
        startedAt: new Date().toISOString(),
        device: {
            platform: process.platform,
            architecture: process.arch,
            osRelease: os.release(),
            osVersion: os.version(),
            cpuModel: os.cpus()[0]?.model,
            logicalProcessors: os.cpus().length,
            totalMemoryBytes: os.totalmem(),
            freeMemoryBytesAtStart: os.freemem(),
            node: process.version,
            sqlite: process.versions.sqlite,
            powerStorageAndCompetingLoad: 'not observed by this script',
        },
        fixture: {
            version: 'courseflow-ga-reference-v1',
            approved: true,
            term: ['2026-09-01', '2026-12-18', 'America/Toronto'],
            courseCount: 5,
            weeklyMeetingRules: 15,
            onceTasks: 150,
            weeklyTasks: 50,
            initialOnceTaskStates: {pending: 110, completed: 20, skipped: 20},
            fixedKernelClock: CLOCK.now(),
            requestedCalendarWindow: WINDOW,
            ids: 'Formal owners generate entity IDs; exact resulting reference projection is saved',
        },
        profile: SHORT_REFERENCE ? 'short-reference' : 'full-host-kernel',
        approvedP95BudgetsMilliseconds: {
            packagedStartup: 3000,
            coreQuery: 100,
            formalCommit: 200,
            realBackupQuery: 150,
            realBackupCommit: 250,
            maximumBackupIncrease: 50,
        },
        budgetBoundary: 'Numeric ceilings are approved; kernel observations cannot establish complete G7 acceptance',
        dataSlotsRoot: DATA,
        observations: {},
        notMeasured: [
            'packaged process startup, Electron IPC and Renderer paint',
            'all other platforms; this report records only its actual host',
            'OS cache-cold startup, Main/Renderer/utility event-loop delay',
            'individual backup/restore/migration stage latency and full process-tree RSS',
            'integrity/FK timing, WAL/checkpoint latency, CPU/I/O attribution',
            'complete G7 verdict; p99 is observation only and has no approved threshold',
        ],
    };
    const saveReport = () => writeFileSync(
        path.join(REFERENCE, 'kernel-measurements.json'), `${JSON.stringify(report, null, 2)}\n`,
    );
    let application;
    let epoch;
    let sequence = 0;

    /** Asserts every formal outcome; failed requests are never silently omitted from timing. */
    async function send(request) {
        const outcome = await application.handle(request);
        assert.equal(outcome.ok, true, JSON.stringify(outcome));
        return outcome.value;
    }

    /** Binds a request maker to the current real Workspace epoch. */
    function request(maker, ...args) {
        sequence += 1;
        return maker(`ga-${sequence}`, BUILD, epoch, ...args);
    }

    /** Opens the actual DATA kernel and establishes the epoch through bootstrap. */
    async function open() {
        const started = performance.now();
        application = await WorkspaceApplication.open(DATA, BUILD, {clock: CLOCK});
        const elapsed = performance.now() - started;
        const value = await send({...makeBootstrapRequest(`boot-${sequence++}`, BUILD),
            dataRootClass: 'verified-local'});
        assert.equal(typeof value.workspaceEpoch, 'string');
        epoch = value.workspaceEpoch;
        return {elapsed, value};
    }

    /** Reads current formal versions before constructing a mutating command. */
    async function setup() {
        const value = await send(request(api.makeSetupQueryRequest));
        assert.equal(value.kind, 'workspace.setup-projection');
        return value.projection;
    }

    /** Uses canonical commands and current optimistic versions, with no direct database writes. */
    async function commit(maker, kind, intentSchemaVersion, payload, extra = {}) {
        const projection = await setup();
        const command = {
            commandId: randomUUID(),
            followUpId: randomUUID(),
            expectedRevision: projection.workspaceRevision,
            expectedPlanVersion: projection.planEntityVersion,
            ...extra,
            intent: {kind, intentSchemaVersion, payload},
        };
        const started = performance.now();
        const value = await send(request(maker, command));
        const elapsed = performance.now() - started;
        assert.equal(value.kind, 'workspace.command-outcome', JSON.stringify(value));
        assert.equal(value.outcome.kind, 'committed');
        assert.ok(BigInt(value.outcome.revision) > BigInt(projection.workspaceRevision));
        return {value, elapsed};
    }

    /** Measures the existing shared PLAN projection, optionally with the formal calendar window. */
    async function query(window) {
        const started = performance.now();
        const value = await send(request(api.makePlanQueryRequest, window));
        const elapsed = performance.now() - started;
        assert.equal(value.kind, 'workspace.plan-projection');
        assert.equal(value.projection.term.name, 'G-A Reference Fall 2026');
        return {elapsed, projection: value.projection};
    }

    /** Changes only the designated once task and verifies its current version through the formal query. */
    async function toggle(status) {
        const projection = await setup();
        const task = projection.tasks.find(item => item.title === 'GA Task 000');
        assert.ok(task && task.occurrenceId?.originalLogicalAnchor === 'once');
        return commit(api.makeSetTaskOccurrenceStatusRequest, 'plan.set-task-occurrence-status', 2, {
            taskSeriesId: task.taskSeriesId,
            originalLogicalAnchor: 'once',
            status,
        }, {expectedTaskSeriesVersion: task.entityVersion});
    }

    try {
        const initialOpen = await open();
        report.device.sqlite = initialOpen.value.sqliteVersion;
        const initialized = await send(request(api.makeInitializeWorkspaceRequest));
        assert.equal(initialized.kind, 'workspace.initialized');
        const workspaceId = initialized.workspaceData.workspaceId;
        report.workspaceId = workspaceId;
        report.schemaLevel = initialized.workspaceData.schemaLevel;
        await commit(api.makeCreateTermRequest, 'plan.create-term', 1, {
            name: 'G-A Reference Fall 2026',
            startDate: '2026-09-01',
            endDate: '2026-12-18',
            timeZone: 'America/Toronto',
        });
        const courses = [];
        for (let index = 0; index < 5; index += 1) {
            const meeting = {
                type: 'LEC',
                weekday: 'MON',
                localStart: `${String(9 + index).padStart(2, '0')}:00`,
                localEnd: `${String(10 + index).padStart(2, '0')}:00`,
                endDayOffset: 0,
                effectiveRange: {kind: 'inherit-course'},
                location: {kind: 'tba'},
            };
            const created = await commit(api.makeCreateCourseWithMeetingRequest,
                'plan.create-course-with-first-meeting', 3, {
                    course: {
                        code: `GA${101 + index}`,
                        name: `Reference Course ${index + 1}`,
                        section: null,
                        instructor: null,
                        color: ['blue', 'green', 'orange', 'purple', 'red'][index],
                        credits: null,
                        teachingRange: {kind: 'inherit-term'},
                    },
                    meeting,
                }, {overlapDecision: 'review'});
            const courseId = created.value.outcome.effects.find(effect => effect.entity.kind === 'course').entity.id;
            courses.push(courseId);
            for (const weekday of ['WED', 'FRI']) {
                const current = (await setup()).courses.find(course => course.courseId === courseId);
                await commit(api.makeCreateMeetingSeriesRequest, 'plan.create-meeting-series', 1, {
                    courseId,
                    meeting: {...meeting, weekday},
                }, {overlapDecision: 'review', expectedCourseVersion: current.entityVersion});
            }
        }
        for (let index = 0; index < 200; index += 1) {
            const date = `2026-09-${String(1 + index % 28).padStart(2, '0')}`;
            const deadline = index % 10 === 0 ? {kind: 'tba'}
                : index % 3 === 0 ? {kind: 'timed', instant: `${date}T16:00:00.000Z`, timeZone: 'America/Toronto'}
                    : {kind: 'date-only', date};
            const schedule = index < 150 ? {kind: 'once', deadline} : {
                kind: 'weekly',
                startDate: '2026-09-01',
                weekday: ['MON', 'TUE', 'WED', 'THU', 'FRI'][index % 5],
                localDeadlineTime: '17:00',
                confirmedEndDate: '2026-12-18',
                followTeachingWeek: false,
            };
            await commit(api.makeCreateTaskRequest, 'plan.create-task-series', 2, {
                courseId: courses[index % 5],
                title: `GA Task ${String(index).padStart(3, '0')}`,
                size: index % 4 === 0 ? 'large' : 'small',
                schedule,
            });
        }
        for (let index = 1; index <= 40; index += 1) {
            const task = (await setup()).tasks.find(item => item.title === `GA Task ${String(index).padStart(3, '0')}`);
            await commit(api.makeSetTaskOccurrenceStatusRequest, 'plan.set-task-occurrence-status', 2, {
                taskSeriesId: task.taskSeriesId,
                originalLogicalAnchor: 'once',
                status: index <= 20 ? 'completed' : 'skipped',
            }, {expectedTaskSeriesVersion: task.entityVersion});
        }
        const seeded = await setup();
        assert.equal(seeded.terms.length, 1);
        assert.equal(seeded.courses.length, 5);
        assert.equal(seeded.courses.flatMap(course => course.meetings).length, 15);
        assert.equal(seeded.tasks.length, 200);
        assert.equal(seeded.minimum.isSatisfied, true);
        writeFileSync(path.join(REFERENCE, 'reference-setup.json'), `${JSON.stringify(seeded, null, 2)}\n`);
        report.referenceRevision = seeded.workspaceRevision;
        report.referenceDataBytes = directoryBytes(DATA);
        process.stdout.write('Seeded 1 term, 5 courses, 15 weekly meeting rules, 200 tasks.\n');
        await application.close();
        // ponytail: cached host-process reopen only; use a packaged driver for process-cold startup evidence.
        const cold = [];
        for (let index = 0; index < (SHORT_REFERENCE ? 0 : 20); index += 1) {
            cold.push((await open()).elapsed);
            assert.equal((await setup()).tasks.length, 200);
            await application.close();
        }
        if (cold.length > 0) {
            report.observations.workspaceReopen = {
                method: 'same host Node process; WorkspaceApplication.open only; OS/module caches retained',
                ...summarize(cold),
            };
        }
        await open();
        const queryGroups = SHORT_REFERENCE ? [] : [['planDefault', undefined], ['planSeptemberWindow', WINDOW]];
        for (const [name, window] of queryGroups) {
            for (let index = 0; index < 10; index += 1) {
                await query(window);
            }
            const samples = [];
            for (let index = 0; index < 100; index += 1) {
                samples.push((await query(window)).elapsed);
                await yieldToIo();
            }
            report.observations[name] = summarize(samples);
        }
        const baselineCommits = [];
        for (let index = 0; index < (SHORT_REFERENCE ? 0 : 40); index += 1) {
            baselineCommits.push((await toggle(index % 2 === 0 ? 'completed' : 'pending')).elapsed);
            await yieldToIo();
        }
        if (baselineCommits.length > 0) {
            report.observations.unconfiguredCommit = summarize(baselineCommits);
        }
        saveReport();
        const protection = await send(request(api.makeDataProtectionQueryRequest));
        const configure = api.makeConfigureBackupDestinationRequest(`configure-${sequence++}`, BUILD, epoch, {
            commandId: randomUUID(),
            followUpId: randomUUID(),
            workspaceId,
            expectedRevision: protection.projection.workspaceRevision,
            expectedProtectionVersion: protection.projection.protectionEntityVersion,
            intent: {kind: 'protect.configure-backup-destination', intentSchemaVersion: 1, payload: {}},
        });
        await send(api.makeSelectedBackupDestinationRequest(configure, BACKUP));
        await application.waitForDurableBackups();
        report.initialConfiguredProtection = (await send(request(api.makeDataProtectionQueryRequest))).projection;
        assert.equal(report.initialConfiguredProtection.backup.state, 'current');
        assert.ok(report.initialConfiguredProtection.backup.recentVerifiedSnapshots.length > 0);
        const background = [];
        report.backupSamples = background;
        const configuredCommits = [];
        for (let index = 0; index < (SHORT_REFERENCE ? 20 : 40); index += 1) {
            const committed = await toggle(index % 2 === 0 ? 'completed' : 'pending');
            configuredCommits.push(committed.elapsed);
            await yieldToIo();
            const before = await send(request(api.makeDataProtectionQueryRequest));
            const measured = await query();
            const after = await send(request(api.makeDataProtectionQueryRequest));
            const sample = {
                milliseconds: measured.elapsed,
                commitMilliseconds: committed.elapsed,
                committedRevision: committed.value.outcome.revision,
                stateBefore: before.projection.backup.state,
                stateAfter: after.projection.backup.state,
                neededThrough: before.projection.backup.neededThrough,
                succeededThroughBefore: before.projection.backup.succeededThrough,
                succeededThroughAfter: after.projection.backup.succeededThrough,
            };
            background.push(sample);
            await application.waitForDurableBackups();
            const verified = (await send(request(api.makeDataProtectionQueryRequest))).projection;
            sample.verifiedAfterWait = verified.backup;
            assert.equal(verified.backup.state, 'current');
            assert.ok(BigInt(verified.backup.succeededThrough) >= BigInt(sample.committedRevision));
            await yieldToIo();
        }
        report.observations.configuredCommit = summarize(configuredCommits);
        report.observations.configuredQuery = {
            ...summarize(background.map(sample => sample.milliseconds)),
            backupPendingBeforeCount: background.filter(sample => sample.stateBefore === 'pending').length,
            note: 'Every commit subsequently verified current; pending alone still does not prove CPU/I/O overlap',
        };
        await application.waitForDurableBackups();
        const finalProtection = await send(request(api.makeDataProtectionQueryRequest));
        report.finalProtection = finalProtection.projection;
        assert.equal(finalProtection.projection.backup.state, 'current');
        assert.ok(finalProtection.projection.backup.recentVerifiedSnapshots.length > 0);
        const finalSetup = await setup();
        assert.equal(finalSetup.tasks.find(task => task.title === 'GA Task 000').status, 'pending');
        assert.equal(finalSetup.tasks.length, 200);
        report.finalRevision = finalSetup.workspaceRevision;
        report.kernelMemoryAtEnd = process.memoryUsage();
        report.kernelResourceUsageIncludingSeed = process.resourceUsage();
        report.status = 'completed-partial-evidence-not-g7-pass';
    }
    catch (error) {
        report.status = 'failed';
        report.error = error.stack ?? String(error);
        throw error;
    }
    finally {
        await application?.close();
        report.finishedAt = new Date().toISOString();
        report.referenceDataBytesAtEnd = directoryBytes(DATA);
        report.backupBytesAtEnd = directoryBytes(BACKUP);
        saveReport();
    }
    const compact = Object.fromEntries(Object.entries(report.observations).map(([name, value]) => [name, {
        count: value.count,
        p50Milliseconds: value.p50Milliseconds,
        p95Milliseconds: value.p95Milliseconds,
        backupPendingBeforeCount: value.backupPendingBeforeCount,
    }]));
    process.stdout.write(`${JSON.stringify({status: report.status, observations: compact}, null, 2)}\n`);
}

await main();
