/**
 * @file Verifies Electron runtime trust boundaries and the bounded preload surface.
 */

import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import type * as TypeScriptAst from 'typescript/unstable/ast' with { 'resolution-mode': 'import' };
import type * as TypeScriptIs from 'typescript/unstable/ast/is' with { 'resolution-mode': 'import' };
import type * as TypeScriptSync from 'typescript/unstable/sync' with { 'resolution-mode': 'import' };

const repositoryRoot = process.cwd();
const sourceRoot = path.join(repositoryRoot, 'src');
const rendererRoot = path.join(sourceRoot, 'renderer');
const mainPath = path.join(sourceRoot, 'main.ts');
const preloadPath = path.join(sourceRoot, 'preload.ts');
const forgeConfigPath = path.join(repositoryRoot, 'forge.config.ts');
const packagePath = path.join(repositoryRoot, 'package.json');
const packagedSmokePath = path.join(repositoryRoot, 'scripts', 'run-packaged-smoke.mjs');

type TypeScriptModules = {
  ast: typeof TypeScriptAst;
  is: typeof TypeScriptIs;
  sync: typeof TypeScriptSync;
};

interface CompilerState extends TypeScriptModules {
  api: TypeScriptSync.API;
  snapshot: TypeScriptSync.Snapshot;
  sources: Map<string, TypeScriptAst.SourceFile>;
}

function walkTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkTypeScriptFiles(entryPath) : /\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

const productionSourcePaths = walkTypeScriptFiles(sourceRoot);
const rendererSourcePaths = walkTypeScriptFiles(rendererRoot);
const compilerSourcePaths = [...productionSourcePaths, forgeConfigPath];
let compilerStatePromise: Promise<CompilerState> | undefined;

async function compilerState(): Promise<CompilerState> {
  compilerStatePromise ??= (async () => {
    const [ast, is, sync] = await Promise.all([
      import('typescript/unstable/ast'),
      import('typescript/unstable/ast/is'),
      import('typescript/unstable/sync'),
    ]);
    const api = new sync.API({ cwd: repositoryRoot });
    const snapshot = api.updateSnapshot({ openFiles: compilerSourcePaths });
    const sources = new Map<string, TypeScriptAst.SourceFile>();

    for (const sourcePath of compilerSourcePaths) {
      const source = snapshot.getDefaultProjectForFile(sourcePath)?.program.getSourceFile(sourcePath);
      assert.ok(source, `TypeScript compiler API must parse ${sourcePath}`);
      sources.set(sourcePath, source);
    }

    return { ast, is, sync, api, snapshot, sources };
  })();

  return compilerStatePromise;
}

after(async () => {
  if (!compilerStatePromise) {
    return;
  }

  const state = await compilerStatePromise;
  state.snapshot.dispose();
  state.api.close();
});

function sourceFor(state: CompilerState, sourcePath: string): TypeScriptAst.SourceFile {
  const source = state.sources.get(sourcePath);
  assert.ok(source, `missing parsed source ${sourcePath}`);
  return source;
}

function visit(node: TypeScriptAst.Node, visitor: (node: TypeScriptAst.Node) => void): void {
  visitor(node);
  node.forEachChild((child) => {
    visit(child, visitor);
    return undefined;
  });
}

function stringLiteralText(state: CompilerState, node: TypeScriptAst.Node | undefined): string | undefined {
  return node && state.is.isStringLiteralLikeNode(node) ? node.text : undefined;
}

function propertyName(state: CompilerState, node: TypeScriptAst.Node | undefined): string | undefined {
  return node && (state.is.isIdentifier(node) || state.is.isStringLiteralLikeNode(node)) ? node.text : undefined;
}

function objectProperty(
  state: CompilerState,
  object: TypeScriptAst.ObjectLiteralExpression,
  name: string,
): TypeScriptAst.Expression | undefined {
  const property = object.properties.find(
    (candidate) => state.is.isPropertyAssignment(candidate) && propertyName(state, candidate.name) === name,
  );
  return property && state.is.isPropertyAssignment(property) ? property.initializer : undefined;
}

function objectElementName(state: CompilerState, element: TypeScriptAst.ObjectLiteralElementLike): string | undefined {
  if (
    state.is.isPropertyAssignment(element) ||
    state.is.isShorthandPropertyAssignment(element) ||
    state.is.isMethodDeclaration(element) ||
    state.is.isGetAccessorDeclaration(element) ||
    state.is.isSetAccessorDeclaration(element)
  ) {
    return propertyName(state, element.name);
  }
  return undefined;
}

interface ModuleLoad {
  specifier?: string;
  dynamic: boolean;
}

function moduleLoads(state: CompilerState, source: TypeScriptAst.SourceFile): ModuleLoad[] {
  const loads: ModuleLoad[] = [];

  visit(source, (node) => {
    if (state.is.isImportDeclaration(node) || state.is.isExportDeclaration(node)) {
      const specifier = stringLiteralText(state, node.moduleSpecifier);
      if (specifier) {
        loads.push({ specifier, dynamic: false });
      }
      return;
    }

    if (state.is.isImportEqualsDeclaration(node) && state.is.isExternalModuleReference(node.moduleReference)) {
      const specifier = stringLiteralText(state, node.moduleReference.expression);
      if (specifier) {
        loads.push({ specifier, dynamic: false });
      }
      return;
    }

    if (!state.is.isCallExpression(node)) {
      return;
    }

    const dynamicImport = state.is.isImportExpression(node.expression);
    const requireCall = state.is.isIdentifier(node.expression) && node.expression.text === 'require';
    if (dynamicImport || requireCall) {
      loads.push({ specifier: stringLiteralText(state, node.arguments[0]), dynamic: true });
    }
  });

  return loads;
}

function moduleSpecifiers(state: CompilerState, source: TypeScriptAst.SourceFile): string[] {
  return moduleLoads(state, source).flatMap(({ specifier }) => (specifier ? [specifier] : []));
}

function isNodeBuiltin(specifier: string): boolean {
  const bareSpecifier = specifier.replace(/^node:/, '');
  return builtinModules.some(
    (moduleName) => bareSpecifier === moduleName || bareSpecifier.startsWith(`${moduleName}/`),
  );
}

function publicObject(
  state: CompilerState,
  expression: TypeScriptAst.Expression | undefined,
): TypeScriptAst.ObjectLiteralExpression | undefined {
  if (expression && state.is.isObjectLiteralExpression(expression)) {
    return expression;
  }
  if (
    expression &&
    state.is.isCallExpression(expression) &&
    state.is.isPropertyAccessExpression(expression.expression) &&
    state.is.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === 'Object' &&
    expression.expression.name.text === 'freeze' &&
    expression.arguments[0] &&
    state.is.isObjectLiteralExpression(expression.arguments[0])
  ) {
    return expression.arguments[0];
  }
  return undefined;
}

function exposedFunction(
  state: CompilerState,
  source: TypeScriptAst.SourceFile,
  expression: TypeScriptAst.Expression,
): TypeScriptAst.FunctionLikeDeclaration | undefined {
  if (state.is.isArrowFunction(expression) || state.is.isFunctionExpression(expression)) {
    return expression;
  }
  if (!state.is.isIdentifier(expression)) {
    return undefined;
  }

  for (const statement of source.statements) {
    if (state.is.isFunctionDeclaration(statement) && statement.name?.text === expression.text) {
      return statement;
    }

    if (!state.is.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        state.is.isIdentifier(declaration.name) &&
        declaration.name.text === expression.text &&
        declaration.initializer &&
        (state.is.isArrowFunction(declaration.initializer) || state.is.isFunctionExpression(declaration.initializer))
      ) {
        return declaration.initializer;
      }
    }
  }

  return undefined;
}

function visitExecutedBody(
  state: CompilerState,
  body: TypeScriptAst.ConciseBody,
  visitor: (node: TypeScriptAst.Node) => void,
): void {
  const walk = (node: TypeScriptAst.Node): void => {
    visitor(node);
    node.forEachChild((child) => {
      if (!state.is.isFunctionLikeDeclaration(child)) {
        walk(child);
      }
      return undefined;
    });
  };

  walk(body);
}

function publicMethod(
  state: CompilerState,
  source: TypeScriptAst.SourceFile,
  element: TypeScriptAst.ObjectLiteralElementLike,
): TypeScriptAst.FunctionLikeDeclaration | undefined {
  if (state.is.isPropertyAssignment(element)) {
    return exposedFunction(state, source, element.initializer);
  }
  if (state.is.isShorthandPropertyAssignment(element)) {
    return state.is.isIdentifier(element.name) ? exposedFunction(state, source, element.name) : undefined;
  }
  return state.is.isMethodDeclaration(element) ? element : undefined;
}

function browserWindowOptions(state: CompilerState): TypeScriptAst.ObjectLiteralExpression {
  const options: TypeScriptAst.ObjectLiteralExpression[] = [];
  visit(sourceFor(state, mainPath), (node) => {
    if (
      state.is.isNewExpression(node) &&
      state.is.isIdentifier(node.expression) &&
      node.expression.text === 'BrowserWindow' &&
      node.arguments?.[0] &&
      state.is.isObjectLiteralExpression(node.arguments[0])
    ) {
      options.push(node.arguments[0]);
    }
  });
  assert.equal(options.length, 1, 'production source must construct exactly one BrowserWindow');
  return options[0]!;
}

function platformBranch(
  state: CompilerState,
  source: TypeScriptAst.SourceFile,
  platform: string,
): TypeScriptAst.IfStatement {
  const branches: TypeScriptAst.IfStatement[] = [];
  visit(source, (node) => {
    if (
      state.is.isIfStatement(node) &&
      state.is.isBinaryExpression(node.expression) &&
      node.expression.operatorToken.kind === state.ast.SyntaxKind.EqualsEqualsEqualsToken &&
      state.is.isPropertyAccessExpression(node.expression.left) &&
      state.is.isIdentifier(node.expression.left.expression) &&
      node.expression.left.expression.text === 'process' &&
      node.expression.left.name.text === 'platform' &&
      stringLiteralText(state, node.expression.right) === platform
    ) {
      branches.push(node);
    }
  });
  assert.equal(branches.length, 1, `Main must have exactly one ${platform} platform branch`);
  return branches[0]!;
}

function identifierMethodCalls(
  state: CompilerState,
  node: TypeScriptAst.Node,
  receiver: string,
  method: string,
): TypeScriptAst.CallExpression[] {
  const calls: TypeScriptAst.CallExpression[] = [];
  visit(node, (candidate) => {
    if (
      state.is.isCallExpression(candidate) &&
      state.is.isPropertyAccessExpression(candidate.expression) &&
      state.is.isIdentifier(candidate.expression.expression) &&
      candidate.expression.expression.text === receiver &&
      candidate.expression.name.text === method
    ) {
      calls.push(candidate);
    }
  });
  return calls;
}

function isForbiddenRuntimeModule(specifier: string): boolean {
  const lower = specifier.toLowerCase();
  return (
    lower === 'electron-log' ||
    lower === 'electron-updater' ||
    lower === 'update-electron-app' ||
    lower.startsWith('@sentry/') ||
    lower === 'sentry' ||
    lower.startsWith('@opentelemetry/') ||
    /(?:^|[-/@])(analytics|telemetry)(?:$|[-/])/.test(lower) ||
    ['http', 'https', 'http2', 'node:http', 'node:https', 'node:http2'].includes(lower) ||
    ['axios', 'got', 'ky', 'node-fetch', 'cross-fetch', 'undici', 'superagent', 'needle', 'request'].includes(lower) ||
    lower.startsWith('@electron-forge/maker-') ||
    lower.startsWith('@electron-forge/publisher-')
  );
}

function canonicalCompilerPath(sourcePath: string): string {
  const resolved = path.resolve(sourcePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isGlobalReference(state: CompilerState, sourcePath: string, node: TypeScriptAst.Identifier): boolean {
  const project = state.snapshot.getDefaultProjectForFile(sourcePath);
  const symbol = project?.checker.getSymbolAtLocation(node);
  if (!symbol) {
    return false;
  }
  if (symbol.declarations.length === 0) {
    return true;
  }

  const canonicalSourcePath = canonicalCompilerPath(sourcePath);
  return symbol.declarations.every(
    (declaration) => canonicalCompilerPath(String(declaration.path)) !== canonicalSourcePath,
  );
}

const globalNetworkMembers = new Map<string, Set<string>>([
  ['globalThis', new Set(['EventSource', 'WebSocket', 'XMLHttpRequest', 'fetch'])],
  ['self', new Set(['EventSource', 'WebSocket', 'XMLHttpRequest', 'fetch'])],
  ['window', new Set(['EventSource', 'WebSocket', 'XMLHttpRequest', 'fetch'])],
  ['navigator', new Set(['sendBeacon'])],
]);

function globalNetworkReference(
  state: CompilerState,
  sourcePath: string,
  node: TypeScriptAst.Node,
): string | undefined {
  if (
    state.is.isIdentifier(node) &&
    ['EventSource', 'WebSocket', 'XMLHttpRequest'].includes(node.text) &&
    !(node.parent && state.is.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
    isGlobalReference(state, sourcePath, node)
  ) {
    return node.text;
  }
  if (!state.is.isPropertyAccessExpression(node) && !state.is.isElementAccessExpression(node)) {
    return undefined;
  }

  const receiver = node.expression;
  const receiverName = state.is.isIdentifier(receiver) ? receiver.text : undefined;
  const globalReceiver = state.is.isIdentifier(receiver) && isGlobalReference(state, sourcePath, receiver);
  const capabilityName = state.is.isPropertyAccessExpression(node)
    ? node.name.text
    : stringLiteralText(state, node.argumentExpression);
  return receiverName && capabilityName && globalReceiver && globalNetworkMembers.get(receiverName)?.has(capabilityName)
    ? `${receiverName}.${capabilityName}`
    : undefined;
}

function topLevelVariableInitializer(
  state: CompilerState,
  source: TypeScriptAst.SourceFile,
  name: string,
): TypeScriptAst.Expression | undefined {
  for (const statement of source.statements) {
    if (!state.is.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (state.is.isIdentifier(declaration.name) && declaration.name.text === name) {
        return declaration.initializer;
      }
    }
  }
  return undefined;
}

function exportedForgeConfig(state: CompilerState): TypeScriptAst.ObjectLiteralExpression {
  const source = sourceFor(state, forgeConfigPath);
  const exports = source.statements.filter((statement) => state.is.isExportAssignment(statement));
  assert.equal(exports.length, 1, 'Forge config must have one default export');
  assert.equal(exports[0]!.isExportEquals, false, 'Forge config must use a default export');

  const exported = exports[0]!.expression;
  const resolved = state.is.isIdentifier(exported)
    ? topLevelVariableInitializer(state, source, exported.text)
    : exported;
  assert.ok(
    resolved && state.is.isObjectLiteralExpression(resolved),
    'Forge default export must resolve to an object literal',
  );
  return resolved;
}

test('production keeps one utility process and Renderer imports no privileged runtime capability', async () => {
  const state = await compilerState();
  const utilityForkCalls: TypeScriptAst.CallExpression[] = [];

  for (const sourcePath of productionSourcePaths) {
    visit(sourceFor(state, sourcePath), (node) => {
      if (
        state.is.isCallExpression(node) &&
        state.is.isPropertyAccessExpression(node.expression) &&
        state.is.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'utilityProcess' &&
        node.expression.name.text === 'fork'
      ) {
        utilityForkCalls.push(node);
      }
    });
  }

  const rendererViolations = rendererSourcePaths.flatMap((sourcePath) => {
    const source = sourceFor(state, sourcePath);
    const privilegedImports = moduleLoads(state, source).flatMap(({ specifier, dynamic }) =>
      dynamic && !specifier
        ? ['non-literal dynamic module load']
        : specifier === 'electron' ||
            specifier?.startsWith('electron/') ||
            (specifier ? isNodeBuiltin(specifier) : false)
          ? [specifier]
          : [],
    );
    const messagePortUses: string[] = [];
    visit(source, (node) => {
      if (state.is.isIdentifier(node) && node.text === 'MessagePort') {
        messagePortUses.push('MessagePort');
      }
    });
    return [...privilegedImports, ...messagePortUses].map(
      (violation) => `${path.relative(repositoryRoot, sourcePath)}: ${violation}`,
    );
  });

  assert.equal(utilityForkCalls.length, 1);
  const dataSlotsRootArgument = utilityForkCalls[0]!.arguments[1];
  assert.ok(dataSlotsRootArgument && state.is.isArrayLiteralExpression(dataSlotsRootArgument));
  assert.equal(dataSlotsRootArgument.elements.length, 4);
  assert.equal(stringLiteralText(state, dataSlotsRootArgument.elements[0]), '--courseflow-data-slots-root');
  const rootValue = dataSlotsRootArgument.elements[1];
  assert.equal(
    rootValue !== undefined && state.is.isPropertyAccessExpression(rootValue)
      && state.is.isIdentifier(rootValue.expression)
      && rootValue.expression.text === 'roots'
      && rootValue.name.text === 'dataSlotsRoot',
    true,
  );
  assert.equal(
    stringLiteralText(state, dataSlotsRootArgument.elements[2]),
    '--courseflow-activity-control-root',
  );
  const activityRootValue = dataSlotsRootArgument.elements[3];
  assert.equal(
    activityRootValue !== undefined && state.is.isPropertyAccessExpression(activityRootValue)
      && state.is.isIdentifier(activityRootValue.expression)
      && activityRootValue.expression.text === 'roots'
      && activityRootValue.name.text === 'activityControlRoot',
    true,
  );

  const workspaceSpecifiers = moduleSpecifiers(state, sourceFor(state, path.join(sourceRoot, 'workspace.ts')));
  assert.deepEqual(
    workspaceSpecifiers.filter((specifier) => /^node:(?:fs|path|sqlite)(?:\/|$)/.test(specifier)),
    [],
  );

  const nodeSqliteImporters = productionSourcePaths
    .filter((sourcePath) => moduleSpecifiers(state, sourceFor(state, sourcePath)).includes('node:sqlite'))
    .map((sourcePath) => path.relative(repositoryRoot, sourcePath).replaceAll('\\', '/'))
    .sort();
  assert.deepEqual(nodeSqliteImporters, [
    'src/data/schema.ts',
    'src/data/sqlite-data-store.ts',
  ]);
  assert.deepEqual(rendererViolations, []);
});

test('Main awaits graceful Workspace shutdown for smoke exit and ordinary quit', async () => {
  const state = await compilerState();
  const main = sourceFor(state, mainPath);
  const beforeQuitHandlers: TypeScriptAst.FunctionLikeDeclaration[] = [];
  let exitSmoke: TypeScriptAst.FunctionLikeDeclaration | undefined;
  for (const statement of main.statements) {
    if (state.is.isFunctionDeclaration(statement) && statement.name?.text === 'exitSmoke') {
      exitSmoke = statement;
    }
  }

  function gracefulAwaitPositionsIn(node: TypeScriptAst.Node): number[] {
    const positions: number[] = [];
    visit(node, (candidate) => {
      if (!state.is.isAwaitExpression(candidate)) {
        return;
      }
      const expression = candidate.expression;
      if (
        state.is.isCallExpression(expression) &&
        state.is.isPropertyAccessExpression(expression.expression) &&
        expression.expression.name.text === 'gracefulShutdown'
      ) {
        positions.push(candidate.getStart(main));
      }
    });
    return positions;
  }

  function methodCallPositionsIn(node: TypeScriptAst.Node, receiver: string, method: string): number[] {
    const positions: number[] = [];
    visit(node, (candidate) => {
      if (
        state.is.isCallExpression(candidate) &&
        state.is.isPropertyAccessExpression(candidate.expression) &&
        state.is.isIdentifier(candidate.expression.expression) &&
        candidate.expression.expression.text === receiver &&
        candidate.expression.name.text === method
      ) {
        positions.push(candidate.getStart(main));
      }
    });
    return positions;
  }

  visit(main, (node) => {
    if (
      state.is.isCallExpression(node) &&
      state.is.isPropertyAccessExpression(node.expression) &&
      state.is.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'app' &&
      node.expression.name.text === 'on' &&
      stringLiteralText(state, node.arguments[0]) === 'before-quit' &&
      node.arguments[1] &&
      state.is.isFunctionLikeDeclaration(node.arguments[1])
    ) {
      beforeQuitHandlers.push(node.arguments[1]);
    }
  });

  assert.ok(exitSmoke?.body, 'Main must retain the smoke exit function');
  const smokeAwaits = gracefulAwaitPositionsIn(exitSmoke.body);
  const smokeExits = methodCallPositionsIn(exitSmoke.body, 'app', 'exit');
  assert.equal(smokeAwaits.length, 1);
  assert.equal(smokeExits.length, 1);
  assert.ok(smokeAwaits[0]! < smokeExits[0]!);
  assert.equal(beforeQuitHandlers.length, 1);
  const beforeQuit = beforeQuitHandlers[0]!;
  assert.ok(beforeQuit.body);
  const quitAwaits = gracefulAwaitPositionsIn(beforeQuit.body);
  const preventDefaults = methodCallPositionsIn(beforeQuit.body, 'event', 'preventDefault');
  const reentryQuits = methodCallPositionsIn(beforeQuit.body, 'app', 'quit');
  assert.equal(quitAwaits.length, 1);
  assert.equal(preventDefaults.length, 1);
  assert.equal(reentryQuits.length, 1);
  assert.ok(preventDefaults[0]! < quitAwaits[0]! && quitAwaits[0]! < reentryQuits[0]!);
  assert.equal(
    state.is.isBlock(beforeQuit.body) && beforeQuit.body.statements.some(
      (statement) =>
        state.is.isIfStatement(statement) &&
        (state.is.isReturnStatement(statement.thenStatement) ||
          (state.is.isBlock(statement.thenStatement) &&
            statement.thenStatement.statements.some((child) => state.is.isReturnStatement(child)))),
    ),
    true,
  );
});

test('preload exposes separate bounded Workspace and window capabilities on fixed IPC channels', async () => {
  const state = await compilerState();
  const preload = sourceFor(state, preloadPath);
  const exposeCalls: TypeScriptAst.CallExpression[] = [];
  const allowedContextBridgeReferences = new Set<TypeScriptAst.Node>();

  visit(preload, (node) => {
    if (!state.is.isCallExpression(node) || !state.is.isPropertyAccessExpression(node.expression)) {
      return;
    }
    const receiver = node.expression.expression;
    if (
      state.is.isIdentifier(receiver) &&
      receiver.text === 'contextBridge' &&
      node.expression.name.text === 'exposeInMainWorld'
    ) {
      exposeCalls.push(node);
      allowedContextBridgeReferences.add(receiver);
    }
  });

  assert.equal(exposeCalls.length, 2);
  const contextBridgeReferenceViolations: number[] = [];
  visit(preload, (node) => {
    if (!state.is.isIdentifier(node) || node.text !== 'contextBridge') {
      return;
    }
    const importBinding = node.parent && state.is.isImportSpecifier(node.parent) && node.parent.name === node;
    if (!importBinding && !allowedContextBridgeReferences.has(node)) {
      contextBridgeReferenceViolations.push(node.getStart(preload));
    }
  });
  assert.deepEqual(
    contextBridgeReferenceViolations,
    [],
    'preload must use contextBridge only for the two direct bounded exposures',
  );
  const exposeCall = exposeCalls.find(call => stringLiteralText(state, call.arguments[0]) === 'courseFlow');
  assert.ok(exposeCall, 'preload must expose the bounded Workspace surface');
  const exposedObject = publicObject(state, exposeCall.arguments[1]);
  assert.ok(exposedObject, 'courseFlow must expose an object literal, optionally frozen');
  assert.deepEqual(
    exposedObject.properties.map((property) => objectElementName(state, property)),
    [
      'query',
      'initialize',
      'querySetup',
      'queryDataProtection',
      'configureBackupDestination',
      'startRestoreSession',
      'queryRestoreSession',
      'confirmRestoreSession',
      'saveSetupDraftCheckpoint',
      'discardSetupDraftCheckpoint',
      'queryPlan',
      'createTerm',
      'updateTermEndDate',
      'createHolidayRange',
      'updateHolidayRange',
      'deleteHolidayRange',
      'createTask',
      'updateTask',
      'deleteTask',
      'completeTask',
      'setTaskOccurrenceStatus',
      'setTaskProgress',
      'changeTaskOccurrence',
      'deleteTaskOccurrenceOrSeries',
      'undoTaskOccurrenceState',
      'restoreTermAsCurrent',
      'createCourse',
      'createMeetingSeries',
      'createCourseWithMeeting',
      'queryMeetingSeries',
      'queryTaskSeries',
      'previewTaskOccurrence',
      'previewMeetingOccurrence',
      'changeMeetingOccurrence',
      'cancelMeetingOccurrence',
    ],
  );
  const expectedParameterCounts = [
    0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1,
  ];
  exposedObject.properties.forEach((property, index) => {
    const method = publicMethod(state, preload, property);
    assert.ok(method, 'each exposed setup capability must resolve to a function body');
    assert.equal(method.parameters.length, expectedParameterCounts[index]);
    assert.ok(method.body);
  });

  const windowExposeCall = exposeCalls.find(
    call => stringLiteralText(state, call.arguments[0]) === 'courseFlowWindow',
  );
  assert.ok(windowExposeCall, 'preload must expose the bounded window surface separately');
  const windowObject = publicObject(state, windowExposeCall.arguments[1]);
  assert.ok(windowObject, 'courseFlowWindow must expose an object literal, optionally frozen');
  assert.deepEqual(windowObject.properties.map(property => objectElementName(state, property)), ['control']);
  const windowControl = publicMethod(state, preload, windowObject.properties[0]!);
  assert.ok(windowControl?.body);
  assert.equal(windowControl.parameters.length, 1);

  const ipcCalls: TypeScriptAst.CallExpression[] = [];
  const allowedIpcReferences = new Set<TypeScriptAst.Node>();
  visit(preload, (node) => {
    if (
      state.is.isCallExpression(node) &&
      state.is.isPropertyAccessExpression(node.expression) &&
      state.is.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'ipcRenderer' &&
      (node.expression.name.text === 'invoke' || node.expression.name.text === 'send')
    ) {
      ipcCalls.push(node);
      allowedIpcReferences.add(node.expression.expression);
    }
  });

  assert.equal(
    ipcCalls.length,
    3,
    'preload must use two Workspace invokes and one bounded window send',
  );
  assert.deepEqual(
    ipcCalls.map((call) => {
      const channel = call.arguments[0];
      const name = state.is.isPropertyAccessExpression(call.expression) ? call.expression.name.text : undefined;
      return state.is.isIdentifier(channel) ? `${name}:${channel.text}` : undefined;
    }).sort(),
    [
      'invoke:WORKSPACE_QUERY_CHANNEL',
      'invoke:WORKSPACE_SETUP_CHANNEL',
      'send:WINDOW_CONTROL_CHANNEL',
    ],
  );

  const ipcReferenceViolations: number[] = [];
  visit(preload, (node) => {
    if (!state.is.isIdentifier(node) || node.text !== 'ipcRenderer') {
      return;
    }
    const importBinding = node.parent && state.is.isImportSpecifier(node.parent) && node.parent.name === node;
    if (!importBinding && !allowedIpcReferences.has(node)) {
      ipcReferenceViolations.push(node.getStart(preload));
    }
  });
  assert.deepEqual(
    ipcReferenceViolations,
    [],
    'preload must not alias IPC or use it outside the three fixed-channel calls',
  );
});

test('Main classifies every known Task occurrence request as a setup validation failure', async () => {
  const state = await compilerState();
  const main = sourceFor(state, mainPath).getText();
  const validationMarker = /\)\r?\n          \? 'validation'/.exec(main)?.index ?? -1;

  assert.ok(validationMarker >= 0, 'validation branch must remain explicit');

  for (const kind of [
    'workspace.task.set-occurrence-status',
    'workspace.task.set-progress',
    'workspace.task.change-occurrence',
    'workspace.task.delete-occurrence-or-series',
    'workspace.task.undo-occurrence-state',
    'workspace.task-occurrence.preview',
  ]) {
    assert.ok(main.indexOf(`kind === '${kind}'`) >= 0, `${kind} must be recognized`);
    assert.ok(main.indexOf(`kind === '${kind}'`) < validationMarker, `${kind} must be validation`);
  }
});

test('BrowserWindow keeps every required security preference explicit', async () => {
  const state = await compilerState();
  const webPreferences = objectProperty(state, browserWindowOptions(state), 'webPreferences');
  assert.ok(webPreferences && state.is.isObjectLiteralExpression(webPreferences));

  assert.equal(objectProperty(state, webPreferences, 'contextIsolation')?.kind, state.ast.SyntaxKind.TrueKeyword);
  assert.equal(objectProperty(state, webPreferences, 'sandbox')?.kind, state.ast.SyntaxKind.TrueKeyword);
  assert.equal(objectProperty(state, webPreferences, 'nodeIntegration')?.kind, state.ast.SyntaxKind.FalseKeyword);
  assert.equal(objectProperty(state, webPreferences, 'webSecurity')?.kind, state.ast.SyntaxKind.TrueKeyword);
});

test('BrowserWindow hides title chrome without disabling the native resize frame', async () => {
  const state = await compilerState();
  const options = browserWindowOptions(state);

  assert.equal(stringLiteralText(state, objectProperty(state, options, 'titleBarStyle')), 'hidden');
  assert.equal(objectProperty(state, options, 'thickFrame')?.kind, state.ast.SyntaxKind.TrueKeyword);
  assert.equal(objectProperty(state, options, 'frame'), undefined);
  assert.equal(objectProperty(state, options, 'titleBarOverlay'), undefined);
});

test('Main removes only the Windows application menu and hides only native macOS window buttons', async () => {
  const state = await compilerState();
  const main = sourceFor(state, mainPath);
  const windowsBranch = platformBranch(state, main, 'win32');
  const macBranch = platformBranch(state, main, 'darwin');
  const menuCalls = identifierMethodCalls(state, main, 'Menu', 'setApplicationMenu');
  const windowsMenuCalls = identifierMethodCalls(state, windowsBranch, 'Menu', 'setApplicationMenu');
  const nativeButtonCalls = identifierMethodCalls(state, main, 'window', 'setWindowButtonVisibility');
  const macButtonCalls = identifierMethodCalls(state, macBranch, 'window', 'setWindowButtonVisibility');

  assert.equal(menuCalls.length, 1);
  assert.equal(windowsMenuCalls.length, 1);
  assert.equal(windowsMenuCalls[0]!.arguments[0]?.kind, state.ast.SyntaxKind.NullKeyword);
  assert.equal(nativeButtonCalls.length, 1);
  assert.equal(macButtonCalls.length, 1);
  assert.equal(macButtonCalls[0]!.arguments[0]?.kind, state.ast.SyntaxKind.FalseKeyword);
});

test('Main accepts window controls only from its active Renderer with a known action', async () => {
  const state = await compilerState();
  const main = sourceFor(state, mainPath);
  const handlers = identifierMethodCalls(state, main, 'ipcMain', 'on').filter(
    call => state.is.isIdentifier(call.arguments[0]) && call.arguments[0].text === 'WINDOW_CONTROL_CHANNEL',
  );

  assert.equal(handlers.length, 1);
  const handler = handlers[0]!.arguments[1];
  assert.ok(handler && state.is.isFunctionLikeDeclaration(handler) && handler.body);
  const body = handler.body.getText(main);
  assert.match(body, /event\.sender\s*!==\s*window\?\.webContents/);
  assert.match(body, /!isWindowControlAction\(action\)/);
  assert.match(body, /applyWindowControl\(window, action\)/);
});

test('production has no diagnostics, telemetry, remote client, maker, or publisher', async () => {
  const state = await compilerState();
  const sourceViolations: string[] = [];
  const allowedElectronImports = new Map([
    [mainPath, ['app', 'BrowserWindow', 'dialog', 'ipcMain', 'Menu', 'utilityProcess'].sort()],
    [preloadPath, ['contextBridge', 'ipcRenderer'].sort()],
  ]);

  for (const sourcePath of productionSourcePaths) {
    const source = sourceFor(state, sourcePath);
    const relativeSource = path.relative(repositoryRoot, sourcePath);
    const loads = moduleLoads(state, source);
    for (const { specifier, dynamic } of loads) {
      if (dynamic && !specifier) {
        sourceViolations.push(`${relativeSource}: non-literal dynamic module load`);
      } else if (specifier && isForbiddenRuntimeModule(specifier)) {
        sourceViolations.push(`${relativeSource}: ${specifier}`);
      }
    }

    const electronImports = source.statements.filter(
      (statement) =>
        state.is.isImportDeclaration(statement) && stringLiteralText(state, statement.moduleSpecifier) === 'electron',
    );
    const electronLoads = loads.filter(
      ({ specifier }) => specifier === 'electron' || specifier?.startsWith('electron/'),
    );
    const expectedElectronImports = allowedElectronImports.get(sourcePath) ?? [];
    if (
      electronLoads.length !== electronImports.length ||
      electronLoads.some(({ specifier, dynamic }) => dynamic || specifier !== 'electron')
    ) {
      sourceViolations.push(`${relativeSource}: unexpected Electron module load form`);
    }
    if (electronImports.length !== (expectedElectronImports.length > 0 ? 1 : 0)) {
      sourceViolations.push(`${relativeSource}: unexpected Electron import declaration count`);
    } else if (electronImports[0] && state.is.isImportDeclaration(electronImports[0])) {
      const importClause = electronImports[0].importClause;
      const namedBindings = importClause?.namedBindings;
      const exactNamedImports =
        !importClause?.name && namedBindings && state.is.isNamedImports(namedBindings)
          ? namedBindings.elements.map((element) => {
              const importedName = element.propertyName?.text ?? element.name.text;
              return !element.propertyName && !element.isTypeOnly ? importedName : `modified:${importedName}`;
            })
          : [];
      if (
        !namedBindings ||
        !state.is.isNamedImports(namedBindings) ||
        exactNamedImports.length !== expectedElectronImports.length ||
        exactNamedImports.sort().some((name, index) => name !== expectedElectronImports[index])
      ) {
        sourceViolations.push(`${relativeSource}: Electron imports must match the approved R1 named surface`);
      }
    }

    visit(source, (node) => {
      const globalCapability = globalNetworkReference(state, sourcePath, node);
      if (globalCapability) {
        sourceViolations.push(`${relativeSource}: ${globalCapability}`);
      }
      if (
        state.is.isIdentifier(node) &&
        node.text === 'fetch' &&
        !(node.parent && state.is.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
        isGlobalReference(state, sourcePath, node)
      ) {
        sourceViolations.push(`${relativeSource}: global fetch`);
      }
    });
  }

  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const allowedDependencies = ['react', 'react-dom'];
  const allowedDevDependencies = [
    '@electron-forge/cli',
    '@electron-forge/plugin-vite',
    '@types/node',
    '@types/react',
    '@types/react-dom',
    'electron',
    'typescript',
    'vite',
  ];
  const forgeConfig = exportedForgeConfig(state);
  const forgeProperties = new Map<string, TypeScriptAst.Expression[]>();
  const forgePropertyViolations: string[] = [];
  for (const property of forgeConfig.properties) {
    if (state.is.isSpreadAssignment(property)) {
      forgePropertyViolations.push('spread property');
      continue;
    }
    if (state.is.isComputedPropertyName(property.name)) {
      forgePropertyViolations.push('computed property');
      continue;
    }

    const name = objectElementName(state, property);
    if ((name === 'makers' || name === 'publishers') && !state.is.isPropertyAssignment(property)) {
      forgePropertyViolations.push(`${name} must be a direct property assignment`);
      continue;
    }
    if (name && state.is.isPropertyAssignment(property)) {
      const values = forgeProperties.get(name) ?? [];
      values.push(property.initializer);
      forgeProperties.set(name, values);
    }
  }
  const makers = forgeProperties.get('makers') ?? [];
  const publishers = forgeProperties.get('publishers') ?? [];

  assert.deepEqual(sourceViolations, []);
  assert.deepEqual(Object.keys(packageJson.dependencies ?? {}).sort(), allowedDependencies);
  assert.deepEqual(Object.keys(packageJson.devDependencies ?? {}).sort(), allowedDevDependencies);
  assert.deepEqual(forgePropertyViolations, []);
  assert.equal(makers.length, 1, 'Forge makers must be declared exactly once');
  assert.equal(state.is.isArrayLiteralExpression(makers[0]!) && makers[0].elements.length === 0, true);
  assert.equal(publishers.length, 0, 'Forge publishers must be absent');
});

test('package and runtime directories remain development-only', () => {
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    name?: string;
    productName?: string;
    version?: string;
  };
  const forgeConfig = readFileSync(forgeConfigPath, 'utf8');
  const runtimeDirectories = productionSourcePaths
    .map((sourcePath) => path.relative(sourceRoot, path.dirname(sourcePath)).split(path.sep))
    .flat()
    .filter((directory) => /^(?:grade|c1|c2)$/i.test(directory));

  assert.equal(packageJson.name, 'courseflow');
  assert.equal(packageJson.productName, 'CourseFlow Dev');
  assert.equal(packageJson.version, '0.0.0');
  assert.match(forgeConfig, /\bname\s*:\s*['"]CourseFlow Dev['"]/);
  assert.match(forgeConfig, /\bexecutableName\s*:\s*['"]CourseFlow Dev['"]/);
  assert.match(forgeConfig, /\bappBundleId\s*:\s*['"]io\.github\.siruimei07\.courseflow\.dev['"]/);
  assert.deepEqual(runtimeDirectories, []);
});

test('packaged smoke runner source exists', () => {
  assert.equal(existsSync(packagedSmokePath), true, 'scripts/run-packaged-smoke.mjs must exist');
});

test('PROTECT owns backup repository policy while PLATFORM stays a generic filesystem adapter', () => {
  const platform = readFileSync(
    path.join(repositoryRoot, 'src/platform/backup-destination.ts'),
    'utf8',
  );
  const protect = readFileSync(
    path.join(repositoryRoot, 'src/protect/backup-repository.ts'),
    'utf8',
  );

  assert.doesNotMatch(
    platform,
    /BACKUP_REPOSITORY_SCHEMA|CourseFlow|repository-v1|workspaceId|backupSetId|isCanonicalUuid/,
  );
  assert.match(protect, /BACKUP_REPOSITORY_SCHEMA/);
  assert.match(protect, /workspaceId/);
  assert.match(protect, /backupSetId/);
});
