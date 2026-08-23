import {
  isBootstrapOutcome,
  makeBootstrapProblem,
  type BootstrapOutcome,
  type BootstrapRequest,
  type WorkspaceProbeRequest,
} from '../shared/bootstrap-contract';
import {
  isWorkspaceSetupOutcome,
  type WorkspaceSetupOutcome,
  type WorkspaceSetupRequest,
} from '../shared/workspace-setup-contract';

const responseTimeoutMilliseconds = 5_000;
const gracefulShutdownTimeoutMilliseconds = 5_000;
const unavailableMessage = 'Workspace is unavailable. Please try again.';
const lifecycleCloseRequest = Object.freeze({ kind: 'workspace.lifecycle.close' as const });

type PendingQuery = {
  kind: 'bootstrap' | 'setup';
  workspaceEpoch?: string;
  resolve: (outcome: BootstrapOutcome | WorkspaceSetupOutcome) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type WorkspaceUtilityProcess = {
  postMessage(message: unknown): void;
  kill(): unknown;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'error', listener: (...args: unknown[]) => void): unknown;
  on(event: 'exit', listener: () => void): unknown;
  off(event: 'message', listener: (message: unknown) => void): unknown;
  off(event: 'error', listener: (...args: unknown[]) => void): unknown;
  off(event: 'exit', listener: () => void): unknown;
};

export class WorkspaceSupervisor {
  private readonly pending = new Map<string, PendingQuery>();
  private disposed = false;
  private unavailable = false;
  private gracefulShutdownPromise: Promise<void> | undefined;
  private gracefulShutdownResolve: (() => void) | undefined;
  private gracefulShutdownTimeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly appBuildId: string,
    private readonly child: WorkspaceUtilityProcess,
  ) {
    child.on('message', this.handleMessage);
    child.on('error', this.handleError);
    child.on('exit', this.handleExit);
  }

  query(request: BootstrapRequest, dataRootClass: WorkspaceProbeRequest['dataRootClass']): Promise<BootstrapOutcome> {
    if (this.unavailable) {
      return Promise.resolve(this.unavailableOutcome(request.requestId));
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => this.settle(request.requestId, this.unavailableOutcome(request.requestId)), responseTimeoutMilliseconds);
      this.pending.set(request.requestId, {
        kind: 'bootstrap',
        resolve: (outcome) => resolve(outcome as BootstrapOutcome),
        timeout,
      });

      try {
        this.child.postMessage({ ...request, dataRootClass } satisfies WorkspaceProbeRequest);
      } catch {
        this.settle(request.requestId, this.unavailableOutcome(request.requestId));
      }
    });
  }

  request(request: WorkspaceSetupRequest): Promise<WorkspaceSetupOutcome> {
    if (this.unavailable) {
      return Promise.resolve(this.unavailableSetupOutcome(request.requestId, request.workspaceEpoch));
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(
        () => this.settle(
          request.requestId,
          this.unavailableSetupOutcome(request.requestId, request.workspaceEpoch),
        ),
        responseTimeoutMilliseconds,
      );
      this.pending.set(request.requestId, {
        kind: 'setup',
        workspaceEpoch: request.workspaceEpoch,
        resolve: (outcome) => resolve(outcome as WorkspaceSetupOutcome),
        timeout,
      });

      try {
        this.child.postMessage(request);
      } catch {
        this.settle(
          request.requestId,
          this.unavailableSetupOutcome(request.requestId, request.workspaceEpoch),
        );
      }
    });
  }

  dispose(): void {
    this.finish(true);
  }

  gracefulShutdown(): Promise<void> {
    if (this.gracefulShutdownPromise) {
      return this.gracefulShutdownPromise;
    }
    if (this.disposed) {
      return Promise.resolve();
    }

    this.unavailable = true;
    this.gracefulShutdownPromise = new Promise((resolve) => {
      this.gracefulShutdownResolve = resolve;
    });
    this.gracefulShutdownTimeout = setTimeout(
      () => this.finish(true),
      gracefulShutdownTimeoutMilliseconds,
    );

    try {
      this.child.postMessage(lifecycleCloseRequest);
    } catch {
      this.finish(true);
    }
    return this.gracefulShutdownPromise;
  }

  private readonly handleMessage = (message: unknown): void => {
    if (this.isLifecycleCloseAcknowledgement(message)) {
      if (this.gracefulShutdownPromise) {
        this.finish(true);
      }
      return;
    }

    if (this.gracefulShutdownPromise) {
      return;
    }

    const requestId = this.requestIdFrom(message);

    if (!requestId) {
      this.settleAll();
      return;
    }

    const pending = this.pending.get(requestId);
    if (pending?.kind === 'bootstrap' && isBootstrapOutcome(message, this.appBuildId, requestId)) {
      this.settle(requestId, message);
      return;
    }
    if (
      pending?.kind === 'setup'
      && pending.workspaceEpoch
      && isWorkspaceSetupOutcome(message, this.appBuildId, requestId, pending.workspaceEpoch)
    ) {
      this.settle(requestId, message);
      return;
    }

    const unavailable = pending?.kind === 'setup' && pending.workspaceEpoch
      ? this.unavailableSetupOutcome(requestId, pending.workspaceEpoch)
      : this.unavailableOutcome(requestId);
    this.settle(requestId, unavailable);
  };

  private readonly handleExit = (): void => {
    this.finish(false);
  };

  private readonly handleError = (): void => {
    this.finish(true);
  };

  private isLifecycleCloseAcknowledgement(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return (
      Reflect.ownKeys(descriptors).length === 1 &&
      descriptors.kind !== undefined &&
      'value' in descriptors.kind &&
      descriptors.kind.enumerable === true &&
      descriptors.kind.value === 'workspace.lifecycle.closed'
    );
  }

  private requestIdFrom(value: unknown): string | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }

    const outcome = value as { value?: { requestId?: unknown }; problem?: { requestId?: unknown } };
    const requestId = outcome.value?.requestId ?? outcome.problem?.requestId;
    return typeof requestId === 'string' ? requestId : undefined;
  }

  private unavailableOutcome(requestId: string): BootstrapOutcome {
    return makeBootstrapProblem('workspace-unavailable', unavailableMessage, this.appBuildId, requestId);
  }

  private unavailableSetupOutcome(requestId: string, workspaceEpoch: string): WorkspaceSetupOutcome {
    return {
      ok: false,
      problem: {
        code: 'workspace-unavailable',
        message: unavailableMessage,
        requestId,
        appBuildId: this.appBuildId,
        workspaceEpoch,
        dataEffect: 'unchanged',
      },
    };
  }

  private settle(requestId: string, outcome: BootstrapOutcome | WorkspaceSetupOutcome): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(requestId);
    pending.resolve(outcome);
  }

  private settleAll(): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.resolve(
        pending.kind === 'setup' && pending.workspaceEpoch
          ? this.unavailableSetupOutcome(requestId, pending.workspaceEpoch)
          : this.unavailableOutcome(requestId),
      );
    }
    this.pending.clear();
  }

  private finish(kill: boolean): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.unavailable = true;
    if (this.gracefulShutdownTimeout) {
      clearTimeout(this.gracefulShutdownTimeout);
      this.gracefulShutdownTimeout = undefined;
    }
    this.child.off('message', this.handleMessage);
    this.child.off('error', this.handleError);
    this.child.off('exit', this.handleExit);
    if (kill) {
      try {
        this.child.kill();
      } catch {
        // The utility may already have exited while graceful shutdown completed.
      }
    }
    this.settleAll();
    const resolve = this.gracefulShutdownResolve;
    this.gracefulShutdownResolve = undefined;
    resolve?.();
  }
}
