import { app, BrowserWindow, ipcMain, utilityProcess } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  isBootstrapOutcome,
  isBootstrapRequest,
  makeBootstrapProblem,
  WORKSPACE_QUERY_CHANNEL,
} from './shared/bootstrap-contract';
import {
  isWorkspaceSetupRequest,
  WORKSPACE_SETUP_CHANNEL,
  type WorkspaceSetupOutcome,
} from './shared/workspace-setup-contract';
import { isSupportedSqliteVersion } from './shared/sqlite-version';
import { resolveDevelopmentRoots, type DevelopmentRoots } from './main/runtime-paths';
import { createSmokeOutput, writeSmokeLine } from './main/smoke-output';
import { WorkspaceSupervisor } from './main/workspace-supervisor';

let mainWindow: BrowserWindow | undefined;
let workspaceSupervisor: WorkspaceSupervisor | undefined;
let ordinaryQuitPending = false;
const smokeMode = process.argv.includes('--courseflow-smoke');

function requestIdFrom(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const requestId = (value as { requestId?: unknown }).requestId;
  return typeof requestId === 'string' ? requestId : null;
}

function isBuildMismatch(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { appBuildId?: unknown }).appBuildId === 'string' &&
    (value as { appBuildId: string }).appBuildId !== __COURSEFLOW_APP_BUILD_ID__
  );
}

function invalidRequestOutcome(value: unknown) {
  return makeBootstrapProblem(
    isBuildMismatch(value) ? 'build-mismatch' : 'invalid-request',
    'Workspace request is unavailable.',
    __COURSEFLOW_APP_BUILD_ID__,
    requestIdFrom(value),
  );
}

function workspaceEpochFrom(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return '';
  }
  const workspaceEpoch = (value as { workspaceEpoch?: unknown }).workspaceEpoch;
  return typeof workspaceEpoch === 'string' ? workspaceEpoch : '';
}

function invalidSetupRequestOutcome(value: unknown): WorkspaceSetupOutcome {
  const kind = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as { kind?: unknown }).kind
    : undefined;
  return {
    ok: false,
    problem: {
      code: isBuildMismatch(value)
        ? 'build-mismatch'
        : kind === 'workspace.term.create'
          ? 'validation'
          : 'invalid-request',
      message: 'Workspace request is unavailable.',
      requestId: requestIdFrom(value),
      appBuildId: __COURSEFLOW_APP_BUILD_ID__,
      workspaceEpoch: workspaceEpochFrom(value),
      dataEffect: 'unchanged',
    },
  };
}

export async function createWindow(options?: { show?: boolean }): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    show: options?.show ?? true,
    title: 'CourseFlow',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(__dirname, '../renderer', MAIN_WINDOW_VITE_NAME, 'index.html'));
  }

  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });

  return window;
}

function initializeDevelopmentRuntime(): DevelopmentRoots | undefined {
  try {
    const roots = resolveDevelopmentRoots({
      platform: process.platform,
      localAppData: process.env.LOCALAPPDATA,
      appData: app.getPath('appData'),
    });
    const sessionRoot = path.join(roots.chromiumRoot, 'Session');

    for (const directory of [roots.activityControlRoot, roots.dataSlotsRoot, roots.chromiumRoot, sessionRoot]) {
      mkdirSync(directory, { recursive: true });
    }

    app.setPath('userData', roots.chromiumRoot);
    app.setPath('sessionData', sessionRoot);
    if (process.platform === 'win32') {
      app.setAppUserModelId('io.github.siruimei07.courseflow.dev');
    }
    return roots;
  } catch {
    return undefined;
  }
}

async function exitSmoke(code: number): Promise<void> {
  await workspaceSupervisor?.gracefulShutdown();
  app.exit(code);
}

const emitSmokeResult = createSmokeOutput(writeSmokeLine, exitSmoke);

async function runSmokeMode(): Promise<void> {
  try {
    const window = await createWindow({ show: false });
    const outcome = await querySmokeOutcome(window);

    if (!isBootstrapOutcome(outcome, __COURSEFLOW_APP_BUILD_ID__, (outcome as { value?: { requestId?: string } }).value?.requestId ?? '')) {
      throw new Error('Smoke query returned an invalid outcome.');
    }
    if (
      !outcome.ok ||
      !isSupportedSqliteVersion(outcome.value.sqliteVersion) ||
      outcome.value.dataRootClass !== 'verified-local' ||
      (outcome.value.workspaceData.kind !== 'absent' && outcome.value.workspaceData.kind !== 'ready')
    ) {
      throw new Error('Smoke query did not confirm the local SQLite runtime.');
    }

    emitSmokeResult({
      kind: 'courseflow.smoke',
      ok: true,
      appBuildId: outcome.value.appBuildId,
      sqliteVersion: outcome.value.sqliteVersion,
      dataRootClass: outcome.value.dataRootClass,
    }, 0);
  } catch {
    emitSmokeResult({ kind: 'courseflow.smoke', ok: false }, 1);
  }
}

async function querySmokeOutcome(window: BrowserWindow): Promise<unknown> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      window.webContents.executeJavaScript('window.courseFlow.query()'),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Smoke query timed out.')), 5_000);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function startApplication(roots: DevelopmentRoots): Promise<void> {
  const workspace = utilityProcess.fork(path.join(__dirname, 'workspace.js'), [
    '--courseflow-data-slots-root',
    roots.dataSlotsRoot,
  ], {
    serviceName: 'CourseFlow Workspace',
  });
  workspaceSupervisor = new WorkspaceSupervisor(__COURSEFLOW_APP_BUILD_ID__, workspace);

  ipcMain.handle(WORKSPACE_QUERY_CHANNEL, async (event, value) => {
    if (event.sender !== mainWindow?.webContents || !isBootstrapRequest(value, __COURSEFLOW_APP_BUILD_ID__)) {
      return invalidRequestOutcome(value);
    }

    try {
      return await workspaceSupervisor!.query(value, roots.dataRootClass);
    } catch {
      return makeBootstrapProblem(
        'workspace-unavailable',
        'Workspace is unavailable. Please try again.',
        __COURSEFLOW_APP_BUILD_ID__,
        value.requestId,
      );
    }
  });

  ipcMain.handle(WORKSPACE_SETUP_CHANNEL, async (event, value) => {
    const workspaceEpoch = workspaceEpochFrom(value);
    if (
      event.sender !== mainWindow?.webContents
      || !isWorkspaceSetupRequest(value, __COURSEFLOW_APP_BUILD_ID__, workspaceEpoch)
    ) {
      return invalidSetupRequestOutcome(value);
    }

    try {
      return await workspaceSupervisor!.request(value);
    } catch {
      return {
        ok: false,
        problem: {
          code: 'workspace-unavailable',
          message: 'Workspace is unavailable. Please try again.',
          requestId: value.requestId,
          appBuildId: __COURSEFLOW_APP_BUILD_ID__,
          workspaceEpoch: value.workspaceEpoch,
          dataEffect: 'unchanged',
        },
      } satisfies WorkspaceSetupOutcome;
    }
  });

  if (smokeMode) {
    await runSmokeMode();
  } else {
    await createWindow();
  }
}

const developmentRoots = initializeDevelopmentRuntime();
const hasSingleInstanceLock = developmentRoots !== undefined && app.requestSingleInstanceLock();

if (!developmentRoots || !hasSingleInstanceLock) {
  if (smokeMode) {
    emitSmokeResult({ kind: 'courseflow.smoke', ok: false }, 1);
  }
  if (!smokeMode) {
    app.exit(1);
  }
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow?.focus();
  });

  void app.whenReady().then(() => startApplication(developmentRoots)).catch(() => {
    if (smokeMode) {
      emitSmokeResult({ kind: 'courseflow.smoke', ok: false }, 1);
    } else {
      app.exit(1);
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on('before-quit', (event) => {
  if (ordinaryQuitPending) {
    return;
  }

  ordinaryQuitPending = true;
  event.preventDefault();
  void (async () => {
    await workspaceSupervisor?.gracefulShutdown();
    app.quit();
  })();
});
