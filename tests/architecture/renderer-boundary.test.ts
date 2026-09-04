import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import type * as TypeScriptAst from 'typescript/unstable/ast' with { 'resolution-mode': 'import' };
import type * as TypeScriptIs from 'typescript/unstable/ast/is' with { 'resolution-mode': 'import' };
import type * as TypeScriptSync from 'typescript/unstable/sync' with { 'resolution-mode': 'import' };

const repositoryRoot = process.cwd();
const rendererDirectory = path.join(repositoryRoot, 'src/renderer');
const mainPath = path.join(repositoryRoot, 'src/main.ts');
const rendererHtmlPath = path.join(rendererDirectory, 'index.html');

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

let compilerStatePromise: Promise<CompilerState> | undefined;

function walkSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return walkSourceFiles(entryPath);
    }

    return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

async function compilerState(): Promise<CompilerState> {
  compilerStatePromise ??= (async () => {
    const [ast, is, sync] = await Promise.all([
      import('typescript/unstable/ast'),
      import('typescript/unstable/ast/is'),
      import('typescript/unstable/sync'),
    ]);
    const sourcePaths = [mainPath, ...walkSourceFiles(rendererDirectory)];
    const api = new sync.API({ cwd: repositoryRoot });
    const snapshot = api.updateSnapshot({ openFiles: sourcePaths });
    const sources = new Map<string, TypeScriptAst.SourceFile>();

    for (const sourcePath of sourcePaths) {
      const project = snapshot.getDefaultProjectForFile(sourcePath);
      const source = project?.program.getSourceFile(sourcePath);
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

function moduleSpecifiers(state: CompilerState, source: TypeScriptAst.SourceFile): string[] {
  const specifiers: string[] = [];

  visit(source, (node) => {
    if (state.is.isImportDeclaration(node) || state.is.isExportDeclaration(node)) {
      const specifier = stringLiteralText(state, node.moduleSpecifier);
      if (specifier) {
        specifiers.push(specifier);
      }
      return;
    }

    if (state.is.isImportEqualsDeclaration(node) && state.is.isExternalModuleReference(node.moduleReference)) {
      const specifier = stringLiteralText(state, node.moduleReference.expression);
      if (specifier) {
        specifiers.push(specifier);
      }
      return;
    }

    if (!state.is.isCallExpression(node) || node.arguments.length !== 1) {
      return;
    }

    const isDynamicImport = state.is.isImportExpression(node.expression);
    const isRequire = state.is.isIdentifier(node.expression) && node.expression.text === 'require';
    const specifier = stringLiteralText(state, node.arguments[0]);
    if ((isDynamicImport || isRequire) && specifier) {
      specifiers.push(specifier);
    }
  });

  return specifiers;
}

function isForbiddenSpecifier(specifier: string): boolean {
  return (
    specifier === 'electron' ||
    specifier.startsWith('electron/') ||
    specifier.startsWith('node:') ||
    specifier === 'fs' ||
    specifier.startsWith('fs/') ||
    specifier === 'path' ||
    specifier.startsWith('path/') ||
    specifier === 'sqlite' ||
    specifier.startsWith('sqlite/')
  );
}

function rendererViolations(state: CompilerState, sourcePath: string): string[] {
  const source = sourceFor(state, sourcePath);
  const violations = moduleSpecifiers(state, source)
    .filter(isForbiddenSpecifier)
    .map((specifier) => `${sourcePath}: forbidden module specifier ${specifier}`);

  visit(source, (node) => {
    if (state.is.isIdentifier(node) && (node.text === 'ipcRenderer' || node.text === 'MessagePort')) {
      violations.push(`${sourcePath}: forbidden runtime capability ${node.text}`);
    }

    if (
      state.is.isPropertyAccessExpression(node) &&
      state.is.isIdentifier(node.expression) &&
      node.expression.text === 'process' &&
      node.name.text === 'env'
    ) {
      violations.push(`${sourcePath}: forbidden runtime capability process.env`);
    }

    const literal = stringLiteralText(state, node);
    if (literal && /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Applications|Library|System|Users|Volumes)(?:\/|$))/.test(literal)) {
      violations.push(`${sourcePath}: absolute platform path`);
    }
  });

  return violations;
}

function propertyName(state: CompilerState, name: TypeScriptAst.PropertyName): string | undefined {
  return state.is.isIdentifier(name) || state.is.isStringLiteralLikeNode(name) || state.is.isNumericLiteral(name)
    ? name.text
    : undefined;
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

function objectPropertyIs(
  state: CompilerState,
  object: TypeScriptAst.ObjectLiteralExpression,
  name: string,
  kind: TypeScriptAst.SyntaxKind,
): boolean {
  return objectProperty(state, object, name)?.kind === kind;
}

interface BrowserWindowConstruction {
  windowName: string;
  options: TypeScriptAst.ObjectLiteralExpression;
}

function browserWindowConstruction(state: CompilerState): BrowserWindowConstruction {
  const constructions: BrowserWindowConstruction[] = [];

  visit(sourceFor(state, mainPath), (node) => {
    if (
      !state.is.isNewExpression(node) ||
      !state.is.isIdentifier(node.expression) ||
      node.expression.text !== 'BrowserWindow' ||
      !state.is.isVariableDeclaration(node.parent) ||
      !state.is.isIdentifier(node.parent.name) ||
      !node.arguments?.[0] ||
      !state.is.isObjectLiteralExpression(node.arguments[0])
    ) {
      return;
    }

    constructions.push({ windowName: node.parent.name.text, options: node.arguments[0] });
  });

  assert.equal(constructions.length, 1, 'main must configure exactly one real BrowserWindow construction');
  return constructions[0]!;
}

function isWindowWebContents(
  state: CompilerState,
  expression: TypeScriptAst.Expression,
  windowName: string,
): boolean {
  return (
    state.is.isPropertyAccessExpression(expression) &&
    expression.name.text === 'webContents' &&
    state.is.isIdentifier(expression.expression) &&
    expression.expression.text === windowName
  );
}

function isWindowSession(state: CompilerState, expression: TypeScriptAst.Expression, windowName: string): boolean {
  return (
    state.is.isPropertyAccessExpression(expression) &&
    expression.name.text === 'session' &&
    isWindowWebContents(state, expression.expression, windowName)
  );
}

function callsOn(
  state: CompilerState,
  receiver: (expression: TypeScriptAst.Expression) => boolean,
  method: string,
): TypeScriptAst.CallExpression[] {
  const calls: TypeScriptAst.CallExpression[] = [];

  visit(sourceFor(state, mainPath), (node) => {
    if (
      state.is.isCallExpression(node) &&
      state.is.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === method &&
      receiver(node.expression.expression)
    ) {
      calls.push(node);
    }
  });

  return calls;
}

function functionLike(
  state: CompilerState,
  node: TypeScriptAst.Node | undefined,
): TypeScriptAst.ArrowFunction | TypeScriptAst.FunctionExpression | undefined {
  return node && (state.is.isArrowFunction(node) || state.is.isFunctionExpression(node)) ? node : undefined;
}

function functionReturnsFalse(
  state: CompilerState,
  handler: TypeScriptAst.ArrowFunction | TypeScriptAst.FunctionExpression,
): boolean {
  if (state.is.isFalseLiteral(handler.body)) {
    return true;
  }

  let returnsFalse = false;
  visit(handler.body, (node) => {
    if (state.is.isReturnStatement(node) && node.expression && state.is.isFalseLiteral(node.expression)) {
      returnsFalse = true;
    }
  });
  return returnsFalse;
}

function functionCallsFirstParameterPreventDefault(
  state: CompilerState,
  handler: TypeScriptAst.ArrowFunction | TypeScriptAst.FunctionExpression,
): boolean {
  const parameter = handler.parameters[0];
  if (!parameter || !state.is.isIdentifier(parameter.name)) {
    return false;
  }
  const parameterName = parameter.name.text;

  let preventsDefault = false;
  visit(handler.body, (node) => {
    if (
      state.is.isCallExpression(node) &&
      state.is.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'preventDefault' &&
      state.is.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === parameterName
    ) {
      preventsDefault = true;
    }
  });
  return preventsDefault;
}

function functionReturnsWindowDeny(
  state: CompilerState,
  handler: TypeScriptAst.ArrowFunction | TypeScriptAst.FunctionExpression,
): boolean {
  const returnExpressions: TypeScriptAst.Expression[] = [];
  const body = state.is.isParenthesizedExpression(handler.body) ? handler.body.expression : handler.body;

  if (state.is.isObjectLiteralExpression(body)) {
    returnExpressions.push(body);
  } else {
    visit(body, (node) => {
      if (state.is.isReturnStatement(node) && node.expression) {
        returnExpressions.push(node.expression);
      }
    });
  }

  return returnExpressions.some(
    (expression) =>
      state.is.isObjectLiteralExpression(expression) &&
      stringLiteralText(state, objectProperty(state, expression, 'action')) === 'deny',
  );
}

function functionCallsPermissionCallbackWithFalse(
  state: CompilerState,
  handler: TypeScriptAst.ArrowFunction | TypeScriptAst.FunctionExpression,
): boolean {
  const callback = handler.parameters[2];
  if (!callback || !state.is.isIdentifier(callback.name)) {
    return false;
  }
  const callbackName = callback.name.text;

  let deniesPermission = false;
  visit(handler.body, (node) => {
    if (
      state.is.isCallExpression(node) &&
      state.is.isIdentifier(node.expression) &&
      node.expression.text === callbackName &&
      node.arguments[0] &&
      state.is.isFalseLiteral(node.arguments[0])
    ) {
      deniesPermission = true;
    }
  });
  return deniesPermission;
}

test('renderer sources recursively reject static, side-effect, dynamic, require, and subpath privileged imports', async () => {
  const state = await compilerState();
  const rendererSources = walkSourceFiles(rendererDirectory);
  assert.ok(rendererSources.length > 0, 'renderer must contain TypeScript sources');

  const violations = rendererSources.flatMap((sourcePath) => rendererViolations(state, sourcePath));
  assert.deepEqual(violations, []);
});

test('main configures the real BrowserWindow with every required web preference', async () => {
  const state = await compilerState();
  const construction = browserWindowConstruction(state);
  const webPreferences = objectProperty(state, construction.options, 'webPreferences');

  assert.ok(webPreferences && state.is.isObjectLiteralExpression(webPreferences), 'BrowserWindow must have webPreferences');
  assert.equal(objectPropertyIs(state, webPreferences, 'contextIsolation', state.ast.SyntaxKind.TrueKeyword), true);
  assert.equal(objectPropertyIs(state, webPreferences, 'sandbox', state.ast.SyntaxKind.TrueKeyword), true);
  assert.equal(objectPropertyIs(state, webPreferences, 'nodeIntegration', state.ast.SyntaxKind.FalseKeyword), true);
  assert.equal(objectPropertyIs(state, webPreferences, 'webSecurity', state.ast.SyntaxKind.TrueKeyword), true);
});

test('main prevents navigation from the real BrowserWindow webContents', async () => {
  const state = await compilerState();
  const { windowName } = browserWindowConstruction(state);
  const navigationHandlers = callsOn(state, (receiver) => isWindowWebContents(state, receiver, windowName), 'on').filter(
    (call) => stringLiteralText(state, call.arguments[0]) === 'will-navigate',
  );

  assert.equal(
    navigationHandlers.some((call) => {
      const handler = functionLike(state, call.arguments[1]);
      return handler ? functionCallsFirstParameterPreventDefault(state, handler) : false;
    }),
    true,
  );
});

test('main denies new windows from the real BrowserWindow webContents', async () => {
  const state = await compilerState();
  const { windowName } = browserWindowConstruction(state);
  const windowHandlers = callsOn(state, (receiver) => isWindowWebContents(state, receiver, windowName), 'setWindowOpenHandler');

  assert.equal(
    windowHandlers.some((call) => {
      const handler = functionLike(state, call.arguments[0]);
      return handler ? functionReturnsWindowDeny(state, handler) : false;
    }),
    true,
  );
});

test('main rejects permission checks and permission requests for the real BrowserWindow session', async () => {
  const state = await compilerState();
  const { windowName } = browserWindowConstruction(state);
  const permissionChecks = callsOn(
    state,
    (receiver) => isWindowSession(state, receiver, windowName),
    'setPermissionCheckHandler',
  );
  const permissionRequests = callsOn(
    state,
    (receiver) => isWindowSession(state, receiver, windowName),
    'setPermissionRequestHandler',
  );

  assert.equal(
    permissionChecks.some((call) => {
      const handler = functionLike(state, call.arguments[0]);
      return handler ? functionReturnsFalse(state, handler) : false;
    }),
    true,
  );
  assert.equal(
    permissionRequests.some((call) => {
      const handler = functionLike(state, call.arguments[0]);
      return handler ? functionCallsPermissionCallbackWithFalse(state, handler) : false;
    }),
    true,
  );
});

test('renderer HTML has a restrictive Content Security Policy supported by meta delivery', () => {
  const html = readFileSync(rendererHtmlPath, 'utf8');
  const csp = /<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"[^>]*>/i.exec(html)?.[1];

  assert.ok(csp, 'renderer HTML must define a Content-Security-Policy meta tag');

  const directives = new Map(
    csp.split(';').map((directive) => {
      const [name, ...values] = directive.trim().split(/\s+/);
      return [name, values.join(' ')];
    }),
  );

  assert.equal(directives.get('default-src'), "'self'");
  assert.equal(directives.get('script-src'), "'self'");
  assert.equal(directives.get('style-src'), "'self'");
  assert.equal(directives.get('img-src'), "'self'");
  assert.equal(directives.get('connect-src'), "'none'");
  assert.equal(directives.get('object-src'), "'none'");
  assert.equal(directives.get('base-uri'), "'none'");
  assert.equal(directives.get('form-action'), "'none'");
  assert.equal(directives.get('frame-src'), "'none'");
  assert.equal(directives.has('frame-ancestors'), false, 'frame-ancestors is ignored in a meta CSP');
});
