/**
 * @file Runs the exact disposable old/new development-build migration fixture.
 */

import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

/**
 * Last clean development endpoint before schema level 16.
 *
 * @const
 * @type {string}
 */
const PINNED_OLD_COMMIT = '2361554e7e0a18c11ed0ce3b4b1da7bab52a6940';

/**
 * Closed fixture format identity.
 *
 * @const
 * @type {string}
 */
const FIXTURE_VERSION = 'courseflow-development-build-fixture-v1';

/**
 * Maximum time allowed for one dependency, test, package, or smoke command.
 *
 * @const
 * @type {number}
 */
const COMMAND_TIMEOUT_MILLISECONDS = 600_000;

/**
 * Exact format markers covered by the fixture descriptor.
 *
 * @const
 * @type {string[]}
 */
const KNOWN_FORMAT_MARKERS = [
    'courseflow-snapshot-manifest-v1',
    'courseflow-backup-repository-v1',
    'courseflow-restore-safety-set-v1',
    'courseflow-activation-plan-v1',
    'courseflow-activation-journal-record-v1',
    'courseflow-restore-session-control-v1',
    'courseflow-migration-safety-copy-v1',
    'courseflow-migration-rollback-handoff-v1',
];

/**
 * Tests whether a value is a plain record.
 *
 * @param {unknown} value Candidate value.
 * @return {boolean} Whether the value is a plain record.
 */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Requires a record to contain only the named keys.
 *
 * @param {unknown} value Candidate record.
 * @param {string[]} keys Required keys.
 * @param {string} label Error label.
 * @return {Record<string, unknown>} Validated record.
 */
function requireExactRecord(value, keys, label) {
    if (!isRecord(value)
        || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(Array.from(keys).sort())) {
        throw new Error(`${label} must have the exact required fields`);
    }
    return value;
}

/**
 * Compares one closed fixture value with its expected value.
 *
 * @param {unknown} actual Candidate value.
 * @param {unknown} expected Required value.
 * @param {string} label Error label.
 * @return {void}
 */
function requireExactValue(actual, expected, label) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${label} does not match the closed fixture scope`);
    }
}

/**
 * Builds the exact expected format set for one endpoint.
 *
 * @param {string[]} restoreActivation Supported ADR-08 activation formats.
 * @return {Record<string, string[]>} Closed format set.
 */
function expectedFormats(restoreActivation) {
    return {
        snapshotManifest: ['courseflow-snapshot-manifest-v1'],
        backupRepository: ['courseflow-backup-repository-v1'],
        restoreSafetySet: ['courseflow-restore-safety-set-v1'],
        restoreActivation,
        migrationSafetyCopy: [],
        migrationRollbackHandoff: [],
    };
}

/**
 * Validates one exact endpoint descriptor.
 *
 * @param {unknown} value Candidate descriptor.
 * @param {string} label Descriptor label.
 * @param {number} schemaLevel Expected current schema.
 * @param {string[]} restoreActivation Expected activation formats.
 * @return {Record<string, unknown>} Validated descriptor.
 */
function requireBuildDescriptor(value, label, schemaLevel, restoreActivation) {
    const descriptor = requireExactRecord(value, [
        'fullCommit',
        'appBuildId',
        'workspaceProtocol',
        'dataSchema',
        'formats',
    ], label);
    if (typeof descriptor.fullCommit !== 'string' || !/^[0-9a-f]{40}$/.test(descriptor.fullCommit)) {
        throw new Error(`${label}.fullCommit must be a 40-character lowercase commit hash`);
    }
    if (descriptor.appBuildId !== `development:${descriptor.fullCommit}`) {
        throw new Error(`${label}.appBuildId must match its full commit`);
    }
    requireExactValue(descriptor.workspaceProtocol, {current: 2, accepted: [2]}, `${label}.workspaceProtocol`);
    requireExactValue(descriptor.dataSchema, {
        current: schemaLevel,
        migrationSources: Array.from({length: schemaLevel - 1}, (_value, index) => index + 1),
        future: 'stop',
    }, `${label}.dataSchema`);
    requireExactValue(descriptor.formats, expectedFormats(restoreActivation), `${label}.formats`);
    return descriptor;
}

/**
 * Validates the complete closed fixture document.
 *
 * @param {unknown} value Parsed fixture JSON.
 * @return {Record<string, unknown>} Validated fixture.
 */
function requireFixture(value) {
    const fixture = requireExactRecord(value, [
        'fixtureVersion',
        'oldBuild',
        'newBuild',
        'dataRoot',
    ], 'fixture');
    if (fixture.fixtureVersion !== FIXTURE_VERSION) {
        throw new Error(`fixtureVersion must equal ${FIXTURE_VERSION}`);
    }
    if (!isRecord(fixture.oldBuild) || fixture.oldBuild.fullCommit !== PINNED_OLD_COMMIT) {
        throw new Error('oldBuild.fullCommit must equal the pinned old endpoint');
    }
    const oldBuild = requireBuildDescriptor(fixture.oldBuild, 'oldBuild', 15, []);
    const newBuild = requireBuildDescriptor(fixture.newBuild, 'newBuild', 16, [
        'courseflow-activation-plan-v1',
        'courseflow-activation-journal-record-v1',
        'courseflow-restore-session-control-v1',
    ]);
    if (oldBuild.fullCommit === newBuild.fullCommit) {
        throw new Error('oldBuild and newBuild full commits must differ');
    }
    requireExactValue(fixture.dataRoot, {
        kind: 'os-temporary',
        disposable: true,
        realDataAllowed: false,
    }, 'dataRoot');
    return fixture;
}

/**
 * Parses the deliberately narrow runner command line.
 *
 * @param {string[]} args Process arguments after the script path.
 * @return {{fixturePath: string, validateOnly: boolean}} Parsed arguments.
 */
function parseArguments(args) {
    let fixturePath;
    let validateOnly = false;
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--fixture' && fixturePath === undefined) {
            fixturePath = args[index + 1];
            index += 1;
        }
        else if (argument === '--validate-only' && !validateOnly) {
            validateOnly = true;
        }
        else {
            throw new Error(`unsupported fixture argument: ${String(argument)}`);
        }
    }
    if (typeof fixturePath !== 'string' || !path.isAbsolute(fixturePath)) {
        throw new Error('--fixture must name an absolute JSON path');
    }
    return {fixturePath, validateOnly};
}

/**
 * Reads and validates a fixture document.
 *
 * @param {string} fixturePath Absolute fixture path.
 * @return {Record<string, unknown>} Validated fixture.
 */
function readFixture(fixturePath) {
    return requireFixture(JSON.parse(readFileSync(fixturePath, 'utf8')));
}

/**
 * Runs a child process and returns captured UTF-8 output.
 *
 * @param {string} command Executable name.
 * @param {string[]} args Exact argument vector.
 * @param {Record<string, unknown>} options Process options.
 * @return {{stdout: string, stderr: string}} Captured output.
 */
function runCaptured(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd,
        encoding: 'utf8',
        env: options.env,
        maxBuffer: 50 * 1024 * 1024,
        shell: options.shell ?? false,
        timeout: options.timeout ?? COMMAND_TIMEOUT_MILLISECONDS,
        windowsHide: true,
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        const detail = String(result.stderr || result.stdout).trim();
        throw new Error(`${options.description ?? command} exited with code ${String(result.status)}: ${detail}`);
    }
    return {stdout: String(result.stdout), stderr: String(result.stderr)};
}

/**
 * Runs one visible command and preserves its output as evidence.
 *
 * @param {string} command Executable name.
 * @param {string[]} args Exact argument vector.
 * @param {Record<string, unknown>} options Process options.
 * @return {string} Captured stdout.
 */
function runVisible(command, args, options = {}) {
    const result = runCaptured(command, args, options);
    if (result.stdout) {
        process.stdout.write(result.stdout);
    }
    if (result.stderr) {
        process.stderr.write(result.stderr);
    }
    return result.stdout;
}

/**
 * Runs Git against a fixed repository root.
 *
 * @param {string} repositoryRoot Repository root.
 * @param {string[]} args Exact Git arguments.
 * @return {string} Trimmed stdout.
 */
function runGit(repositoryRoot, args) {
    return runCaptured('git', ['-C', repositoryRoot, ...args], {description: 'git'}).stdout.trim();
}

/**
 * Runs the repository-owned pnpm toolchain command.
 *
 * @param {string} sourceRoot Exact-build source root.
 * @param {string[]} args Exact pnpm arguments.
 * @param {NodeJS.ProcessEnv} env Child environment.
 * @return {string} Captured stdout.
 */
function runPnpm(sourceRoot, args, env = process.env) {
    const command = process.platform === 'win32'
        ? process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe'
        : 'pnpm';
    const commandArguments = process.platform === 'win32'
        ? ['/d', '/s', '/c', 'pnpm.cmd', ...args]
        : args;
    return runVisible(command, commandArguments, {
        cwd: sourceRoot,
        description: `pnpm ${args.join(' ')}`,
        env,
    });
}

/**
 * Validates that a path is the exact disposable fixture root.
 *
 * @param {string} fixtureRoot Candidate root.
 * @return {string} Validated absolute root.
 */
function requireDisposableFixtureRoot(fixtureRoot) {
    const resolved = path.resolve(fixtureRoot);
    const relative = path.relative(path.resolve(tmpdir()), resolved);
    if (!relative
        || relative.includes(path.sep)
        || !relative.startsWith('courseflow-development-build-fixture-')) {
        throw new Error('fixture root escaped the OS temporary directory');
    }
    return resolved;
}

/**
 * Requires a source worktree to match one exact commit and remain clean.
 *
 * @param {string} sourceRoot Endpoint source root.
 * @param {string} expectedCommit Expected full commit.
 * @return {void}
 */
function requireCleanEndpoint(sourceRoot, expectedCommit) {
    const actualCommit = runGit(sourceRoot, ['rev-parse', 'HEAD']);
    if (actualCommit !== expectedCommit) {
        throw new Error(`endpoint HEAD mismatch: expected ${expectedCommit}, observed ${actualCommit}`);
    }
    if (runGit(sourceRoot, ['status', '--porcelain=v1', '--untracked-files=all'])) {
        throw new Error(`endpoint ${expectedCommit} is not a clean worktree`);
    }
}

/**
 * Adds one detached exact-commit worktree under the disposable fixture root.
 *
 * @param {string} repositoryRoot Orchestrator repository root.
 * @param {string} sourceRoot New endpoint source root.
 * @param {string} commit Exact endpoint commit.
 * @return {void}
 */
function addEndpointWorktree(repositoryRoot, sourceRoot, commit) {
    runVisible('git', ['-C', repositoryRoot, 'worktree', 'add', '--detach', sourceRoot, commit], {
        description: `git worktree add ${commit}`,
    });
    requireCleanEndpoint(sourceRoot, commit);
}

/**
 * Parses the stage's single JSON evidence line.
 *
 * @param {string} stdout Captured stdout.
 * @return {Record<string, unknown>} Parsed evidence.
 */
function parseStageEvidence(stdout) {
    const lines = stdout.split(/\r\n|\n|\r/).filter(line => line.trim());
    if (lines.length !== 1) {
        throw new Error(`fixture stage emitted ${lines.length} non-empty lines`);
    }
    const value = JSON.parse(lines[0]);
    if (!isRecord(value)) {
        throw new Error('fixture stage evidence must be an object');
    }
    return value;
}

/**
 * Runs one stage in a fresh Node process.
 *
 * @param {string} stagePath Absolute stage script path.
 * @param {string} action Closed stage action.
 * @param {string[]} args Exact stage arguments.
 * @return {Record<string, unknown>} Parsed stage evidence.
 */
function runStage(stagePath, action, args) {
    const output = runCaptured(process.execPath, [stagePath, action, ...args], {
        description: `fixture stage ${action}`,
    }).stdout;
    const evidence = parseStageEvidence(output);
    process.stdout.write(`PASS development build fixture stage ${action}\n`);
    return evidence;
}

/**
 * Flattens the endpoint's exact declared format set.
 *
 * @param {Record<string, unknown>} build Endpoint descriptor.
 * @return {string[]} Declared format markers.
 */
function declaredFormats(build) {
    return Object.values(build.formats).flatMap(value => value);
}

/**
 * Verifies source presence and absence for every closed format marker.
 *
 * @param {string} sourceRoot Endpoint source root.
 * @param {Record<string, unknown>} build Endpoint descriptor.
 * @return {void}
 */
function verifyFormatScope(sourceRoot, build) {
    const declared = new Set(declaredFormats(build));
    for (const marker of KNOWN_FORMAT_MARKERS) {
        const result = spawnSync('git', [
            '-C',
            sourceRoot,
            'grep',
            '--quiet',
            '--fixed-strings',
            '--',
            marker,
            'src',
        ], {windowsHide: true});
        if (result.error) {
            throw result.error;
        }
        const present = result.status === 0;
        if (result.status !== 0 && result.status !== 1) {
            throw new Error(`git grep could not inspect format marker ${marker}`);
        }
        if (present !== declared.has(marker)) {
            throw new Error(`format scope mismatch for ${marker} at ${build.fullCommit}`);
        }
    }
}

/**
 * Verifies compiled protocol, schema, and repository format identity.
 *
 * @param {Record<string, unknown>} build Endpoint descriptor.
 * @param {Record<string, unknown>} evidence Stage descriptor evidence.
 * @return {void}
 */
function verifyCompiledDescriptor(build, evidence) {
    requireExactValue(evidence, {
        action: 'describe-build',
        workspaceProtocol: build.workspaceProtocol.current,
        dataSchema: build.dataSchema.current,
        backupRepository: build.formats.backupRepository[0],
    }, `${build.fullCommit} compiled descriptor`);
}

/**
 * Creates an isolated development root for packaged smoke.
 *
 * @param {string} fixtureRoot Disposable fixture root.
 * @param {string} label Endpoint label.
 * @return {NodeJS.ProcessEnv} Isolated child environment.
 */
function smokeEnvironment(fixtureRoot, label) {
    const localAppData = path.join(fixtureRoot, `${label}-local-app-data`);
    mkdirSync(localAppData);
    return {...process.env, LOCALAPPDATA: localAppData};
}

/**
 * Packages and smokes one endpoint, requiring its exact AppBuildId.
 *
 * @param {string} sourceRoot Endpoint source root.
 * @param {Record<string, unknown>} build Endpoint descriptor.
 * @param {string} fixtureRoot Disposable fixture root.
 * @param {string} label Endpoint label.
 * @return {void}
 */
function packageAndSmoke(sourceRoot, build, fixtureRoot, label) {
    runPnpm(sourceRoot, ['run', 'package']);
    const output = runPnpm(
        sourceRoot,
        ['run', 'smoke:packaged'],
        smokeEnvironment(fixtureRoot, label),
    );
    const expected = `PASS packaged smoke win32/x64 ${build.appBuildId} `;
    if (!output.includes(expected)) {
        throw new Error(`${label} packaged smoke did not report its exact AppBuildId`);
    }
    requireCleanEndpoint(sourceRoot, build.fullCommit);
}

/**
 * Verifies both configured commits exist as exact commit objects.
 *
 * @param {string} repositoryRoot Orchestrator repository root.
 * @param {Record<string, unknown>} fixture Validated fixture.
 * @return {void}
 */
function requireEndpointObjects(repositoryRoot, fixture) {
    for (const build of [fixture.oldBuild, fixture.newBuild]) {
        const resolved = runGit(repositoryRoot, ['rev-parse', '--verify', `${build.fullCommit}^{commit}`]);
        if (resolved !== build.fullCommit) {
            throw new Error(`fixture endpoint is not the exact commit ${build.fullCommit}`);
        }
    }
}

/**
 * Removes only exact disposable worktrees and their enclosing fixture root.
 *
 * @param {string} repositoryRoot Orchestrator repository root.
 * @param {string} fixtureRoot Validated disposable root.
 * @param {string[]} worktrees Worktrees that may have been created.
 * @return {void}
 */
function cleanupFixture(repositoryRoot, fixtureRoot, worktrees) {
    const validatedRoot = requireDisposableFixtureRoot(fixtureRoot);
    for (const worktree of worktrees.reverse()) {
        if (path.dirname(path.resolve(worktree)) !== validatedRoot) {
            throw new Error('refusing to remove a worktree outside the fixture root');
        }
        spawnSync('git', ['-C', repositoryRoot, 'worktree', 'remove', '--force', worktree], {
            encoding: 'utf8',
            windowsHide: true,
        });
    }
    spawnSync('git', ['-C', repositoryRoot, 'worktree', 'prune'], {windowsHide: true});
    rmSync(validatedRoot, {recursive: true, force: true});
}

/**
 * Runs all build, migration, restart, and stop assertions in isolated worktrees.
 *
 * @param {Record<string, unknown>} fixture Validated fixture.
 * @return {void}
 */
function runFullFixture(fixture) {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
        throw new Error('full development build fixture currently requires a Windows x64 host');
    }
    const repositoryRoot = runGit(process.cwd(), ['rev-parse', '--show-toplevel']);
    requireEndpointObjects(repositoryRoot, fixture);
    const fixtureRoot = requireDisposableFixtureRoot(mkdtempSync(path.join(
        tmpdir(),
        'courseflow-development-build-fixture-',
    )));
    const oldSourceRoot = path.join(fixtureRoot, 'old-source');
    const newSourceRoot = path.join(fixtureRoot, 'new-source');
    const dataRoot = path.join(fixtureRoot, 'data-slots');
    const stagePath = path.join(repositoryRoot, 'scripts', 'development-build-fixture-stage.cjs');
    const createdWorktrees = [];
    let stages;

    try {
        addEndpointWorktree(repositoryRoot, oldSourceRoot, fixture.oldBuild.fullCommit);
        createdWorktrees.push(oldSourceRoot);
        addEndpointWorktree(repositoryRoot, newSourceRoot, fixture.newBuild.fullCommit);
        createdWorktrees.push(newSourceRoot);
        mkdirSync(dataRoot);

        runPnpm(oldSourceRoot, ['install', '--frozen-lockfile']);
        runPnpm(oldSourceRoot, ['run', 'test:compile']);
        runPnpm(newSourceRoot, ['install', '--frozen-lockfile']);
        runPnpm(newSourceRoot, ['test']);
        runPnpm(newSourceRoot, ['typecheck']);

        verifyFormatScope(oldSourceRoot, fixture.oldBuild);
        verifyFormatScope(newSourceRoot, fixture.newBuild);
        verifyCompiledDescriptor(
            fixture.oldBuild,
            runStage(stagePath, 'describe-build', [oldSourceRoot]),
        );
        verifyCompiledDescriptor(
            fixture.newBuild,
            runStage(stagePath, 'describe-build', [newSourceRoot]),
        );

        stages = {
            oldCreate: runStage(stagePath, 'old-create', [oldSourceRoot, dataRoot]),
            copy: runStage(stagePath, 'copy-before-write', [newSourceRoot, dataRoot]),
            migration: runStage(stagePath, 'migrate', [newSourceRoot, dataRoot]),
            restart: runStage(stagePath, 'reopen', [newSourceRoot, dataRoot]),
            wrong: runStage(stagePath, 'reject-future-schema', [oldSourceRoot, dataRoot]),
            mixed: runStage(stagePath, 'reject-mixed-builds', [
                oldSourceRoot,
                newSourceRoot,
                fixture.oldBuild.appBuildId,
                fixture.newBuild.appBuildId,
            ]),
        };

        packageAndSmoke(oldSourceRoot, fixture.oldBuild, fixtureRoot, 'old');
        packageAndSmoke(newSourceRoot, fixture.newBuild, fixtureRoot, 'new');
    }
    finally {
        cleanupFixture(repositoryRoot, fixtureRoot, createdWorktrees);
    }
    emitFixtureEvidence(fixture, stages);
}

/**
 * Emits path-free evidence for the complete fixture run.
 *
 * @param {Record<string, unknown>} fixture Validated fixture.
 * @param {Record<string, unknown>} stages Stage evidence.
 * @return {void}
 */
function emitFixtureEvidence(fixture, stages) {
    const evidence = {
        fixtureVersion: fixture.fixtureVersion,
        host: 'win32/x64',
        oldBuild: fixture.oldBuild,
        newBuild: fixture.newBuild,
        checks: {
            cleanDetachedWorktrees: true,
            oldBuildGeneratedOldSchema: stages.oldCreate.facts.schemaLevel === '15',
            copyBeforeWritePreservedActive: stages.copy.activeFacts.schemaLevel === '15',
            migrationReachedNewSchema: stages.migration.facts.schemaLevel === '16',
            restartRevalidatedFacts: stages.restart.status.revision === '2',
            wrongBuildStopped: stages.wrong.problem.code === 'incompatible-version',
            mixedBuildStopped: stages.mixed.oldAcceptsNew === false && stages.mixed.newAcceptsOld === false,
            newFullTest: 'pass',
            newTypecheck: 'pass',
            oldPackageSmoke: 'pass',
            newPackageSmoke: 'pass',
        },
        dataRoot: {
            kind: 'os-temporary',
            disposable: true,
            disposedAfterRun: true,
            pathRecorded: false,
        },
    };
    process.stdout.write(`PASS development build fixture ${JSON.stringify(evidence)}\n`);
}

/**
 * Runs fixture validation or the full evidence flow.
 *
 * @return {Promise<void>} Completion signal.
 */
async function main() {
    const options = parseArguments(process.argv.slice(2));
    const fixture = readFixture(options.fixturePath);
    if (options.validateOnly) {
        process.stdout.write('PASS development build fixture input validation\n');
        return;
    }
    runFullFixture(fixture);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    main().catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`FAIL development build fixture: ${message}\n`);
        process.exitCode = 1;
    });
}
